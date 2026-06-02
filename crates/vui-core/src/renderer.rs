//! Double-buffered diff renderer. `back` is what the caller draws into; `front`
//! is what is currently on screen. `paint` walks both buffers and emits the
//! minimal ANSI to turn `front` into `back`, then syncs `front` so the next
//! frame diffs against the new screen state.
//!
//! Two minimizations keep the byte stream small:
//!   - **Lazy frame start:** nothing (not even the sync wrapper) is emitted
//!     until the first changed cell is found, so an unchanged frame is a no-op.
//!   - **Pen state:** the last emitted (fg, bg, attrs) is remembered, so a run
//!     of identically-styled cells emits SGR only once.
//!   - **Cursor contiguity:** a cursor move is emitted only when the next
//!     changed cell is not where the cursor already sits.
//!
//! `back`'s storage is never reallocated except on `resize`, so the pointer
//! handed to Bun for the zero-copy typed-array view stays valid across frames.

use crate::ansi;
use crate::buffer::{Cell, CellBuffer};
use crate::color::Rgba;
use std::io::Write;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Pen {
    fg: Rgba,
    bg: Rgba,
    attrs: u16,
}

pub struct Renderer {
    width: u32,
    height: u32,
    front: CellBuffer,
    back: CellBuffer,
    out: Vec<u8>,
    /// Forces a full repaint next frame (set on construction and resize).
    force: bool,
}

impl Renderer {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            front: CellBuffer::new(width, height),
            back: CellBuffer::new(width, height),
            out: Vec::with_capacity(64 * 1024),
            force: true,
        }
    }

    pub fn back_mut(&mut self) -> &mut CellBuffer {
        &mut self.back
    }

    pub fn cell_count(&self) -> usize {
        self.back.cells.len()
    }

    pub fn back_ptr(&mut self) -> *mut Cell {
        self.back.cells.as_mut_ptr()
    }

    /// Reallocate both buffers to a new size and force a full repaint. The back
    /// buffer pointer changes here, so callers holding a typed-array view must
    /// refetch it after a resize.
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == self.width && height == self.height {
            return;
        }
        self.width = width;
        self.height = height;
        self.front = CellBuffer::new(width, height);
        self.back = CellBuffer::new(width, height);
        self.force = true;
    }

    /// Build the frame's ANSI into `self.out` and sync `front` to `back`. Split
    /// from stdout I/O so tests can inspect the bytes without touching the tty.
    fn paint(&mut self) {
        self.out.clear();
        let w = self.width;
        let h = self.height;
        let force = self.force;

        let mut frame_started = false;
        let mut pen: Option<Pen> = None;
        let mut utf8 = [0u8; 4];

        for y in 0..h {
            // Column the cursor sits at after the last write this row; -1 means
            // "unknown" (row start, or a gap forced a discontinuity).
            let mut cursor_col: i64 = -1;
            for x in 0..w {
                let i = (y as usize) * (w as usize) + (x as usize);
                let back = self.back.cells[i];

                // Trailing half of a wide glyph: never emitted on its own; the
                // leading cell already advanced the cursor across it.
                if back.is_continuation() {
                    continue;
                }

                if !force && back == self.front.cells[i] {
                    cursor_col = -1; // skipped cell breaks contiguity
                    continue;
                }

                if !frame_started {
                    ansi::sync_begin(&mut self.out);
                    ansi::hide_cursor(&mut self.out);
                    frame_started = true;
                }

                if cursor_col != x as i64 {
                    ansi::move_to(&mut self.out, x, y);
                }

                let want = Pen {
                    fg: back.fg,
                    bg: back.bg,
                    attrs: back.attrs,
                };
                if pen != Some(want) {
                    ansi::reset(&mut self.out);
                    ansi::fg(&mut self.out, want.fg);
                    ansi::bg(&mut self.out, want.bg);
                    ansi::attributes(&mut self.out, want.attrs);
                    pen = Some(want);
                }

                let ch = char::from_u32(back.ch).filter(|c| *c != '\0').unwrap_or(' ');
                let wide = (x + 1 < w) && self.back.cells[i + 1].is_continuation();
                // A width-2 glyph with no continuation slot (right edge, or a
                // pair broken via raw buffer writes) would overflow the row;
                // render a space in its place so the line can't smear.
                let glyph = if !wide && crate::width::char_width(ch) >= 2 {
                    ' '
                } else {
                    ch
                };
                let s = glyph.encode_utf8(&mut utf8);
                self.out.extend_from_slice(s.as_bytes());

                // Advance the cursor model by the glyph's column span.
                cursor_col = x as i64 + if wide { 2 } else { 1 };
            }
        }

        if frame_started {
            ansi::reset(&mut self.out);
            ansi::show_cursor(&mut self.out);
            ansi::sync_end(&mut self.out);
        }

        // Sync the screen state for the next diff. One memcpy, no allocation.
        self.front.cells.copy_from_slice(&self.back.cells);
        self.force = false;
    }

    /// Diff and write the frame to stdout under a synchronized-output wrapper.
    pub fn render(&mut self) {
        self.paint();
        if self.out.is_empty() {
            return;
        }
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        let _ = lock.write_all(&self.out);
        let _ = lock.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{attr, DEFAULT_BG, DEFAULT_FG};

    fn red() -> Rgba {
        Rgba::new(255, 0, 0, 255)
    }

    #[test]
    fn first_frame_emits_sync_wrapper_and_content() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.starts_with("\x1b[?2026h"));
        assert!(s.ends_with("\x1b[?2026l"));
        assert!(s.contains("Hi"));
    }

    #[test]
    fn unchanged_frame_emits_nothing() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint(); // first paint clears force and syncs front
        r.paint(); // identical back vs front
        assert!(r.out.is_empty(), "no-op frame should emit zero bytes");
    }

    #[test]
    fn only_changed_cells_are_emitted() {
        let mut r = Renderer::new(5, 1);
        r.back_mut().draw_text(0, 0, "abcde", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        // Change a single cell in the middle.
        r.back_mut().set_cell(2, 0, 'X' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains('X'));
        assert!(!s.contains('a') && !s.contains('e'));
        // A cursor move to column 3 (1-based) positions the single change.
        assert!(s.contains("\x1b[1;3H"));
    }

    #[test]
    fn pen_state_avoids_redundant_sgr() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "abcd", red(), DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        // One contiguous same-style run => exactly one fg SGR.
        assert_eq!(s.matches("\x1b[38;2;255;0;0m").count(), 1);
    }

    #[test]
    fn style_change_re_emits_sgr() {
        let mut r = Renderer::new(2, 1);
        r.back_mut().set_cell(0, 0, 'a' as u32, red(), DEFAULT_BG, 0);
        r.back_mut()
            .set_cell(1, 0, 'b' as u32, red(), DEFAULT_BG, attr::BOLD);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains("\x1b[1m")); // bold applied on the second cell
    }

    #[test]
    fn wide_char_skips_continuation_cell() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "世a", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains('世'));
        assert!(s.contains('a'));
        // 'a' follows the wide glyph contiguously: no cursor move before it.
        assert!(!s.contains("\x1b[1;3H"));
    }

    #[test]
    fn overwriting_continuation_repaints_the_wide_leader() {
        // Half-overwrite: a single write onto a wide glyph's right half must
        // also clear its left half, so no half-glyph lingers on screen.
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "世", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.back_mut().set_cell(1, 0, 'x' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains("\x1b[1;1H"), "leader column must be repainted");
        assert!(s.contains('x'));
        assert!(!s.contains('世'), "stale wide glyph must not survive");
        assert_eq!(r.back.cells[0].ch, ' ' as u32);
    }

    #[test]
    fn overwriting_wide_leader_clears_orphan_half() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "世", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.back_mut().set_cell(0, 0, 'a' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains('a'));
        assert!(!s.contains('世'));
        // The continuation column was cleared to a blank, no longer a glyph half.
        assert!(!r.back.cells[1].is_continuation());
        assert_eq!(r.back.cells[1].ch, ' ' as u32);
    }

    #[test]
    fn wide_glyph_without_continuation_slot_renders_space() {
        // A width-2 glyph planted at the last column (no room for a continuation)
        // must not be emitted, or it would overflow the row.
        let mut r = Renderer::new(2, 1);
        r.back_mut().set_cell(1, 0, '世' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(!s.contains('世'));
    }

    #[test]
    fn resize_forces_full_redraw() {
        let mut r = Renderer::new(4, 1);
        r.back_mut().draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.paint();
        assert!(r.out.is_empty());
        r.resize(6, 2);
        r.paint(); // even an all-blank buffer repaints fully after resize
        assert!(!r.out.is_empty());
    }
}
