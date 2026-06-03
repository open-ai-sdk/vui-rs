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

/// Half-open clip rectangle `[x0,x1) × [y0,y1)` in buffer cells. The clip-aware
/// draw primitives drop every cell outside it, so a JS paint walk can hand a
/// node's content box and let the (cheap, in-Rust) loop clip — "one FFI per op,
/// not one per cell". Coordinates are signed so a node starting off the top/left
/// edge still paints its visible part.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClipRect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl ClipRect {
    #[inline]
    pub fn contains(self, x: i32, y: i32) -> bool {
        x >= self.x0 && x < self.x1 && y >= self.y0 && y < self.y1
    }
}

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

    /// Read a cell, if `(x, y)` is in bounds. Used by paint to preserve the
    /// existing background under "transparent" text (a glyph whose node sets no
    /// bg should not stamp a black cell over whatever it sits on).
    pub fn get_cell(&self, x: u32, y: u32) -> Option<Cell> {
        self.index(x, y).map(|i| self.cells[i])
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

    /// Reallocate to a new size, resetting every cell to a default blank. For
    /// offscreen (canvas/buffered) buffers whose content box changed.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        let len = (width as usize) * (height as usize);
        self.cells = vec![Cell::blank(DEFAULT_FG, DEFAULT_BG); len];
    }

    /// Intersect a caller-supplied clip with the buffer bounds, so any rect is safe.
    #[inline]
    fn clamp_clip(&self, c: ClipRect) -> ClipRect {
        ClipRect {
            x0: c.x0.max(0),
            y0: c.y0.max(0),
            x1: c.x1.min(self.width as i32),
            y1: c.y1.min(self.height as i32),
        }
    }

    /// `set_cell` confined to `clip`. A cell outside the clip (or the buffer) is
    /// dropped; wide-glyph pairing is preserved via `set_cell`.
    pub fn set_cell_clipped(
        &mut self,
        x: i32,
        y: i32,
        ch: u32,
        fg: Rgba,
        bg: Rgba,
        attrs: u16,
        clip: ClipRect,
    ) {
        let clip = self.clamp_clip(clip);
        if clip.contains(x, y) {
            self.set_cell(x as u32, y as u32, ch, fg, bg, attrs);
        }
    }

    /// `fill_rect` confined to `clip`. Signed origin so a rect starting above/left
    /// of the clip still fills its visible part.
    pub fn fill_rect_clipped(&mut self, x: i32, y: i32, w: u32, h: u32, bg: Rgba, clip: ClipRect) {
        let clip = self.clamp_clip(clip);
        let x0 = x.max(clip.x0);
        let y0 = y.max(clip.y0);
        // i64 math so a pathological `w`/`h` can't overflow `i32` before the min
        // clamps it back to the (in-bounds) clip edge.
        let x1 = ((x as i64) + (w as i64)).min(clip.x1 as i64) as i32;
        let y1 = ((y as i64) + (h as i64)).min(clip.y1 as i64) as i32;
        let mut row = y0;
        while row < y1 {
            let mut col = x0;
            while col < x1 {
                self.set_cell(col as u32, row as u32, ' ' as u32, DEFAULT_FG, bg, 0);
                col += 1;
            }
            row += 1;
        }
    }

    /// `draw_text` confined to `clip`. Glyphs left of the clip are skipped (the
    /// column still advances, giving horizontal-clip/scroll behaviour); a wide
    /// glyph straddling either clip edge is dropped, never split.
    pub fn draw_text_clipped(
        &mut self,
        x: i32,
        y: i32,
        text: &str,
        fg: Rgba,
        bg: Rgba,
        attrs: u16,
        clip: ClipRect,
    ) {
        let clip = self.clamp_clip(clip);
        if y < clip.y0 || y >= clip.y1 {
            return;
        }
        let mut col = x;
        for g in text.graphemes(true) {
            let Some(ch) = g.chars().next() else { continue };
            let w = char_width(ch).max(1) as i32;
            if col >= clip.x1 {
                break;
            }
            // Only draw a glyph that fits wholly inside the clip horizontally;
            // a wide glyph straddling the left or right edge is dropped.
            if col >= clip.x0 && col + w <= clip.x1 {
                self.set_cell(col as u32, y as u32, ch as u32, fg, bg, attrs);
                if w == 2 {
                    self.set_cell((col + 1) as u32, y as u32, 0, fg, bg, attrs | attr::WIDE_CONTINUATION);
                }
            }
            col += w;
        }
    }

    /// Composite `src` into this buffer with its top-left at `(dst_x, dst_y)`,
    /// confined to `clip` (and the buffer). The primitive behind buffered/canvas
    /// nodes. Cells go through `set_cell` so wide-glyph pairing stays intact; a
    /// wide pair split by a clip edge is left to the differ (renders a space).
    pub fn blit(&mut self, src: &CellBuffer, dst_x: i32, dst_y: i32, clip: ClipRect) {
        let clip = self.clamp_clip(clip);
        for sy in 0..src.height {
            let dy = dst_y + sy as i32;
            if dy < clip.y0 || dy >= clip.y1 {
                continue;
            }
            for sx in 0..src.width {
                let dx = dst_x + sx as i32;
                if dx < clip.x0 || dx >= clip.x1 {
                    continue;
                }
                let cell = src.cells[(sy as usize) * (src.width as usize) + (sx as usize)];
                self.set_cell(dx as u32, dy as u32, cell.ch, cell.fg, cell.bg, cell.attrs);
            }
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

    fn clip(x0: i32, y0: i32, x1: i32, y1: i32) -> ClipRect {
        ClipRect { x0, y0, x1, y1 }
    }

    #[test]
    fn draw_text_clipped_drops_glyphs_outside_the_clip() {
        let mut b = CellBuffer::new(10, 1);
        // Clip to columns [2,5); only "cde" of "abcdefg" lands, at their columns.
        b.draw_text_clipped(0, 0, "abcdefg", fg(), bg(), 0, clip(2, 0, 5, 1));
        assert_eq!(b.cells[0].ch, ' ' as u32);
        assert_eq!(b.cells[1].ch, ' ' as u32);
        assert_eq!(b.cells[2].ch, 'c' as u32);
        assert_eq!(b.cells[3].ch, 'd' as u32);
        assert_eq!(b.cells[4].ch, 'e' as u32);
        assert_eq!(b.cells[5].ch, ' ' as u32); // outside the clip
    }

    #[test]
    fn draw_text_clipped_drops_wide_glyph_straddling_an_edge() {
        // A width-2 glyph whose pair would cross the right clip edge is dropped.
        let mut b = CellBuffer::new(6, 1);
        b.draw_text_clipped(0, 0, "a世b", fg(), bg(), 0, clip(0, 0, 2, 1));
        assert_eq!(b.cells[0].ch, 'a' as u32);
        assert_eq!(b.cells[1].ch, ' ' as u32); // 世 would straddle col 2 → dropped
        assert!(!b.cells[1].is_continuation());
    }

    #[test]
    fn fill_rect_clipped_only_fills_the_clip_region() {
        let mut b = CellBuffer::new(6, 3);
        let red = Rgba::new(255, 0, 0, 255);
        b.fill_rect_clipped(0, 0, 6, 3, red, clip(1, 1, 4, 2));
        assert_eq!(b.cells[0].bg, bg()); // outside
        assert_eq!(b.cells[1 * 6 + 1].bg, red); // inside
        assert_eq!(b.cells[1 * 6 + 3].bg, red); // inside (x1 exclusive at 4)
        assert_eq!(b.cells[1 * 6 + 4].bg, bg()); // outside
        assert_eq!(b.cells[2 * 6 + 1].bg, bg()); // outside (y1 exclusive at 2)
    }

    #[test]
    fn set_cell_clipped_honours_negative_origin() {
        let mut b = CellBuffer::new(4, 4);
        // Off-buffer / off-clip writes are no-ops, not panics.
        b.set_cell_clipped(-1, 0, 'x' as u32, fg(), bg(), 0, clip(0, 0, 4, 4));
        b.set_cell_clipped(2, 2, 'y' as u32, fg(), bg(), 0, clip(0, 0, 2, 2));
        assert_eq!(b.cells[2 * 4 + 2].ch, ' ' as u32); // outside clip [0,2)
        b.set_cell_clipped(1, 1, 'z' as u32, fg(), bg(), 0, clip(0, 0, 2, 2));
        assert_eq!(b.cells[1 * 4 + 1].ch, 'z' as u32);
    }

    #[test]
    fn blit_composites_clipped_into_dst() {
        let mut src = CellBuffer::new(2, 2);
        let green = Rgba::new(0, 255, 0, 255);
        src.fill_rect(0, 0, 2, 2, green);
        src.set_cell(0, 0, 'q' as u32, fg(), green, 0);
        let mut dst = CellBuffer::new(6, 6);
        // Place src at (3,3) but clip to [3,4)×[3,4): only its top-left cell lands.
        dst.blit(&src, 3, 3, clip(3, 3, 4, 4));
        assert_eq!(dst.cells[3 * 6 + 3].ch, 'q' as u32);
        assert_eq!(dst.cells[3 * 6 + 3].bg, green);
        assert_eq!(dst.cells[3 * 6 + 4].bg, bg()); // clipped out
        assert_eq!(dst.cells[4 * 6 + 3].bg, bg()); // clipped out
    }

    #[test]
    fn resize_reallocates_and_blanks() {
        let mut b = CellBuffer::new(2, 2);
        b.set_cell(0, 0, 'a' as u32, fg(), bg(), 0);
        b.resize(4, 1);
        assert_eq!(b.width, 4);
        assert_eq!(b.height, 1);
        assert_eq!(b.cells.len(), 4);
        assert_eq!(b.cells[0].ch, ' ' as u32);
    }
}
