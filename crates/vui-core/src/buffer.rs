//! The cell grid. A `CellBuffer` is a row-major `Vec<Cell>`; the renderer keeps
//! two of them (front = on screen, back = being drawn) and diffs one against the
//! other. `Cell` is `#[repr(C)]` so Bun can view the back buffer as a typed
//! array and write into it with zero copies.

use crate::color::Rgba;
use crate::width::char_width;
use unicode_segmentation::UnicodeSegmentation;

/// Text attribute bitflags packed into `Cell::attrs`.
pub mod attr {
    pub const BOLD: u16 = 1 << 0;
    pub const DIM: u16 = 1 << 1;
    pub const ITALIC: u16 = 1 << 2;
    pub const UNDERLINE: u16 = 1 << 3;
    pub const STRIKETHROUGH: u16 = 1 << 4;
    pub const INVERSE: u16 = 1 << 5;
    /// Marks the trailing cell of a width-2 glyph. The differ never emits these
    /// directly; the leading cell's glyph advances the cursor across both.
    pub const WIDE_CONTINUATION: u16 = 1 << 6;
}

/// One terminal cell. `ch` is a single codepoint (the leading codepoint of a
/// grapheme cluster in v0). Layout is fixed by `repr(C)` for FFI: 16 bytes
/// (`ch:4, fg:4, bg:4, attrs:2` + 2 padding), 4-byte aligned.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Cell {
    pub ch: u32,
    pub fg: Rgba,
    pub bg: Rgba,
    pub attrs: u16,
}

impl Cell {
    pub const fn blank(fg: Rgba, bg: Rgba) -> Self {
        Self {
            ch: ' ' as u32,
            fg,
            bg,
            attrs: 0,
        }
    }

    pub const fn is_continuation(self) -> bool {
        self.attrs & attr::WIDE_CONTINUATION != 0
    }
}

/// Default glyph color: light grey on black, matching a typical terminal.
pub const DEFAULT_FG: Rgba = Rgba::new(229, 229, 229, 255);
pub const DEFAULT_BG: Rgba = Rgba::new(0, 0, 0, 255);

/// Whether a cell holds a width-2 glyph (and so should own a continuation cell
/// to its right). Continuation cells store `ch == 0` and report width 0.
fn cell_is_wide(c: Cell) -> bool {
    char::from_u32(c.ch).map(char_width).unwrap_or(0) == 2
}

pub struct CellBuffer {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<Cell>,
}

impl CellBuffer {
    pub fn new(width: u32, height: u32) -> Self {
        let len = (width as usize) * (height as usize);
        Self {
            width,
            height,
            cells: vec![Cell::blank(DEFAULT_FG, DEFAULT_BG); len],
        }
    }

    #[inline]
    fn index(&self, x: u32, y: u32) -> Option<usize> {
        if x < self.width && y < self.height {
            Some((y as usize) * (self.width as usize) + (x as usize))
        } else {
            None
        }
    }

    /// Overwrite every cell with a blank of the given background.
    pub fn clear(&mut self, bg: Rgba) {
        let blank = Cell::blank(DEFAULT_FG, bg);
        for c in &mut self.cells {
            *c = blank;
        }
    }

    /// Write one cell, keeping the wide-glyph pairing invariant intact: a
    /// `WIDE_CONTINUATION` cell always sits immediately right of a width-2
    /// leader, and never otherwise. Overwriting half of a pair "defuses" the
    /// other half to a blank (keeping its colors) so the differ — which treats
    /// cells independently — can never leave a half-painted wide glyph onscreen.
    pub fn set_cell(&mut self, x: u32, y: u32, ch: u32, fg: Rgba, bg: Rgba, attrs: u16) {
        let Some(i) = self.index(x, y) else { return };
        let prev = self.cells[i];
        let new = Cell { ch, fg, bg, attrs };
        self.cells[i] = new;

        // Overwrote a wide leader: its trailing continuation is now orphaned.
        if cell_is_wide(prev) && x + 1 < self.width && self.cells[i + 1].is_continuation() {
            self.defuse(i + 1);
        }
        // Wrote a non-continuation into the slot a left wide leader relies on:
        // that leader can no longer render its glyph, so blank it.
        if !new.is_continuation() && x > 0 && cell_is_wide(self.cells[i - 1]) {
            self.defuse(i - 1);
        }
    }

    /// Drop a cell's glyph and attributes (notably `WIDE_CONTINUATION`) while
    /// keeping its colors, so a broken wide-glyph half becomes a clean blank.
    fn defuse(&mut self, i: usize) {
        self.cells[i].ch = ' ' as u32;
        self.cells[i].attrs = 0;
    }

    /// Fill a rectangle's background, leaving each cell a blank space. Clipped to
    /// the buffer bounds. Routed through `set_cell` so a wide glyph straddling an
    /// edge of the rect is defused rather than left half-drawn.
    pub fn fill_rect(&mut self, x: u32, y: u32, w: u32, h: u32, bg: Rgba) {
        for row in y..y.saturating_add(h) {
            for col in x..x.saturating_add(w) {
                self.set_cell(col, row, ' ' as u32, DEFAULT_FG, bg, 0);
            }
        }
    }

    /// Write text starting at `(x, y)`, advancing by each grapheme's column
    /// width. Width-2 glyphs write a `WIDE_CONTINUATION` trailing cell. Glyphs
    /// are clipped at the right edge; a wide glyph that would straddle the edge
    /// is dropped rather than split.
    pub fn draw_text(&mut self, x: u32, y: u32, text: &str, fg: Rgba, bg: Rgba, attrs: u16) {
        if y >= self.height {
            return;
        }
        let mut col = x;
        for g in text.graphemes(true) {
            let Some(ch) = g.chars().next() else { continue };
            let w = char_width(ch).max(1) as u32;
            if col >= self.width {
                break;
            }
            if w == 2 && col + 1 >= self.width {
                break; // would straddle the right edge
            }
            self.set_cell(col, y, ch as u32, fg, bg, attrs);
            if w == 2 {
                self.set_cell(col + 1, y, 0, fg, bg, attrs | attr::WIDE_CONTINUATION);
            }
            col += w;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fg() -> Rgba {
        DEFAULT_FG
    }
    fn bg() -> Rgba {
        DEFAULT_BG
    }

    #[test]
    fn cell_is_16_bytes() {
        assert_eq!(std::mem::size_of::<Cell>(), 16);
        assert_eq!(std::mem::align_of::<Cell>(), 4);
    }

    #[test]
    fn draw_text_writes_codepoints() {
        let mut b = CellBuffer::new(10, 1);
        b.draw_text(0, 0, "Hi", fg(), bg(), 0);
        assert_eq!(b.cells[0].ch, 'H' as u32);
        assert_eq!(b.cells[1].ch, 'i' as u32);
        assert_eq!(b.cells[2].ch, ' ' as u32); // untouched blank
    }

    #[test]
    fn wide_char_writes_continuation() {
        let mut b = CellBuffer::new(10, 1);
        b.draw_text(0, 0, "世", fg(), bg(), 0);
        assert_eq!(b.cells[0].ch, '世' as u32);
        assert!(!b.cells[0].is_continuation());
        assert!(b.cells[1].is_continuation());
        assert_eq!(b.cells[1].ch, 0);
        // next glyph after a wide char lands two columns over
        b.draw_text(0, 0, "世a", fg(), bg(), 0);
        assert_eq!(b.cells[2].ch, 'a' as u32);
    }

    #[test]
    fn draw_text_clips_at_right_edge() {
        let mut b = CellBuffer::new(3, 1);
        b.draw_text(0, 0, "abcdef", fg(), bg(), 0);
        assert_eq!(b.cells[2].ch, 'c' as u32);
        // a wide glyph that would straddle the last column is dropped
        let mut w = CellBuffer::new(3, 1);
        w.draw_text(2, 0, "世", fg(), bg(), 0);
        assert_eq!(w.cells[2].ch, ' ' as u32);
    }

    #[test]
    fn overwriting_wide_leader_defuses_its_continuation() {
        let mut b = CellBuffer::new(4, 1);
        b.draw_text(0, 0, "世", fg(), bg(), 0);
        assert!(b.cells[1].is_continuation());
        // Overwrite the leader with a narrow char: the continuation must clear.
        b.set_cell(0, 0, 'a' as u32, fg(), bg(), 0);
        assert_eq!(b.cells[0].ch, 'a' as u32);
        assert!(!b.cells[1].is_continuation());
        assert_eq!(b.cells[1].ch, ' ' as u32);
    }

    #[test]
    fn writing_into_continuation_slot_defuses_the_leader() {
        let mut b = CellBuffer::new(4, 1);
        b.draw_text(0, 0, "世", fg(), bg(), 0);
        // Write a narrow char where the continuation was: the leader must clear.
        b.set_cell(1, 0, 'x' as u32, fg(), bg(), 0);
        assert_eq!(b.cells[1].ch, 'x' as u32);
        assert_eq!(b.cells[0].ch, ' ' as u32);
        assert!(!b.cells[0].is_continuation());
    }

    #[test]
    fn fill_rect_clips_to_bounds() {
        let mut b = CellBuffer::new(4, 4);
        let blue = Rgba::new(0, 0, 255, 255);
        b.fill_rect(2, 2, 10, 10, blue);
        assert_eq!(b.cells[2 * 4 + 2].bg, blue);
        assert_eq!(b.cells[3 * 4 + 3].bg, blue);
        assert_eq!(b.cells[0].bg, bg());
    }
}
