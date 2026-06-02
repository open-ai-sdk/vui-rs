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
use crate::buffer::{Cell, CellBuffer, DEFAULT_BG};
use crate::color::Rgba;
use crate::node::{NodeId, NodeTree};
use crate::{layout, paint};
use std::io::Write;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Pen {
    fg: Rgba,
    bg: Rgba,
    attrs: u16,
}

/// Map a stored codepoint to a glyph safe to write to the terminal. Control
/// codes — C0 (`< 0x20`), DEL (`0x7f`), and C1 (`0x80..=0x9f`) — are replaced
/// with a space, so user-supplied text and titles (which are stored verbatim as
/// cells) can never be interpreted by the terminal as escape sequences. This is
/// the single emit-side choke point that upholds the "data is cells, never
/// escapes" invariant for both the node-tree paint path and immediate-mode draws.
fn safe_glyph(cp: u32) -> char {
    match char::from_u32(cp) {
        Some(c) if (c as u32) < 0x20 || c as u32 == 0x7f || (0x80..=0x9f).contains(&(c as u32)) => {
            ' '
        }
        Some(c) => c,
        None => ' ',
    }
}

pub struct Renderer {
    width: u32,
    height: u32,
    front: CellBuffer,
    back: CellBuffer,
    out: Vec<u8>,
    /// Forces a full repaint next frame (set on construction and resize).
    force: bool,
    /// The render-node tree. When it has content, `render` composes the back
    /// buffer from it (layout + paint); when empty, the back buffer is left as
    /// the caller drew it (so immediate-mode drawing keeps working).
    tree: NodeTree,
    /// Whether the previous compose painted tree content. Lets an emptied tree
    /// clear its last frame once, instead of leaving it stale on screen.
    tree_painted: bool,
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
            tree: NodeTree::new(width, height),
            tree_painted: false,
        }
    }

    pub fn tree(&self) -> &NodeTree {
        &self.tree
    }
    pub fn tree_mut(&mut self) -> &mut NodeTree {
        &mut self.tree
    }
    pub fn root(&self) -> NodeId {
        self.tree.root()
    }

    /// Compose the back buffer from the node tree, if it has any content. Layout
    /// is recomputed only when the tree is dirty (incremental); the paint walk
    /// runs every frame but is O(nodes) and the diff keeps emitted bytes minimal.
    /// An empty tree leaves the back buffer untouched so immediate-mode drawing
    /// (the immediate-mode FFI draw primitives) keeps working unchanged.
    fn compose_tree(&mut self) {
        let has_content = self
            .tree
            .get(self.tree.root())
            .map(|r| !r.children.is_empty())
            .unwrap_or(false);
        if !has_content {
            // A tree that just lost all its content clears its last frame once;
            // an always-empty tree leaves the back buffer to immediate-mode draws.
            if self.tree_painted {
                self.back.clear(DEFAULT_BG);
                self.tree_painted = false;
            }
            return;
        }
        if self.tree.is_dirty() {
            layout::compute(&mut self.tree, self.width, self.height);
        }
        self.back.clear(DEFAULT_BG);
        paint::paint(&self.tree, &mut self.back);
        self.tree_painted = true;
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
        // Re-size the layout root so the next compose re-lays-out to fit.
        self.tree.set_root_size(width, height);
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
                    // Keep the hardware cursor hidden whenever vui paints: this is
                    // a cell grid that draws its OWN cursor (e.g. an <input>'s block
                    // cursor), so a visible terminal cursor would show up as a
                    // second, stray cursor. The frame never re-shows it; visibility
                    // is owned by the terminal session / app and restored on exit.
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

                let ch = safe_glyph(back.ch);
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
            ansi::sync_end(&mut self.out);
        }

        // Sync the screen state for the next diff. One memcpy, no allocation.
        self.front.cells.copy_from_slice(&self.back.cells);
        self.force = false;
    }

    /// Compose the tree and diff into `out` without touching stdout. Test-only
    /// path mirroring `render` so assertions can inspect the emitted bytes.
    #[cfg(test)]
    fn render_for_test(&mut self) {
        self.compose_tree();
        self.paint();
    }

    /// Diff and write the frame to stdout under a synchronized-output wrapper.
    pub fn render(&mut self) {
        self.compose_tree();
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
    fn control_bytes_in_text_are_never_emitted() {
        // User text containing an escape sequence must be rendered as cells, not
        // passed through as terminal control bytes (ANSI-injection safety).
        let mut r = Renderer::new(8, 1);
        r.back_mut()
            .draw_text(0, 0, "\x1b[2Jx", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let body = String::from_utf8_lossy(&r.out);
        // The user's ESC byte must have been replaced with a space, so the
        // clear-screen sequence never reaches the terminal as contiguous bytes.
        // (The printable tail "[2Jx" is harmless on-screen text.)
        assert!(
            !body.contains("\x1b[2J"),
            "user escape sequence leaked to the terminal"
        );
        assert!(body.contains("[2Jx"), "printable text should still render");
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

/// Integration tests for the node-tree → layout → paint → back-buffer pipeline.
/// They build a tree through the renderer, compose it (no stdout), and read the
/// resulting cells back.
#[cfg(test)]
mod tree_tests {
    use super::*;
    use crate::buffer::{attr, DEFAULT_FG};
    use crate::node::{BorderStyle, NodeKind, TextContent, TextRun, TitleAlign};
    use crate::style::{DimFfi, StyleFfi};

    fn empty_style() -> StyleFfi {
        StyleFfi::default()
    }
    fn len(v: f32) -> DimFfi {
        DimFfi { kind: 1, value: v }
    }
    fn red() -> Rgba {
        Rgba::new(255, 0, 0, 255)
    }
    fn green() -> Rgba {
        Rgba::new(0, 255, 0, 255)
    }
    fn blue() -> Rgba {
        Rgba::new(0, 0, 255, 255)
    }
    fn ch_at(r: &Renderer, x: u32, y: u32) -> char {
        char::from_u32(r.back.get_cell(x, y).unwrap().ch).unwrap()
    }

    #[test]
    fn empty_tree_leaves_immediate_draws_intact() {
        // No tree content: render() must not clear the caller's immediate draws.
        let mut r = Renderer::new(6, 1);
        r.back_mut().draw_text(0, 0, "hey", DEFAULT_FG, DEFAULT_BG, 0);
        r.compose_tree();
        assert_eq!(ch_at(&r, 0, 0), 'h');
    }

    #[test]
    fn bordered_titled_box_paints_frame_and_title() {
        let mut r = Renderer::new(20, 5);
        let root = r.root();
        let b = r.tree_mut().create(NodeKind::Box);
        let mut s = empty_style();
        s.width = len(20.0);
        s.height = len(5.0);
        s.border_left = len(1.0);
        s.border_right = len(1.0);
        s.border_top = len(1.0);
        s.border_bottom = len(1.0);
        r.tree_mut().set_style(b, &s);
        {
            let node = r.tree_mut().get_mut(b).unwrap();
            node.paint.bg = Some(blue());
            node.paint.border = Some(BorderStyle::Single);
            node.paint.border_color = Some(Rgba::new(255, 255, 255, 255));
            node.paint.title = Some("Hi".into());
            node.paint.title_align = TitleAlign::Left;
        }
        r.tree_mut().append_child(root, b);
        r.compose_tree();

        // Corners + a horizontal run glyph.
        assert_eq!(ch_at(&r, 0, 0), '┌');
        assert_eq!(ch_at(&r, 19, 0), '┐');
        assert_eq!(ch_at(&r, 0, 4), '└');
        assert_eq!(ch_at(&r, 19, 4), '┘');
        assert_eq!(ch_at(&r, 0, 2), '│');
        // Title sits just inside the top-left corner, over the top border.
        assert_eq!(ch_at(&r, 1, 0), 'H');
        assert_eq!(ch_at(&r, 2, 0), 'i');
        // Box background filled an interior cell.
        assert_eq!(r.back.get_cell(5, 2).unwrap().bg, blue());
    }

    #[test]
    fn multi_run_text_wraps_and_keeps_per_run_attrs() {
        // Content box is 4 wide, 3 tall; "ab"+"cdef" => "abcd" / "ef".
        let mut r = Renderer::new(4, 3);
        let root = r.root();
        let t = r.tree_mut().create(NodeKind::Text);
        let mut s = empty_style();
        s.width = len(4.0);
        s.height = len(3.0);
        r.tree_mut().set_style(t, &s);
        {
            let node = r.tree_mut().get_mut(t).unwrap();
            node.text = Some(TextContent {
                runs: vec![
                    TextRun {
                        text: "ab".into(),
                        fg: None,
                        bg: None,
                        attrs: 0,
                    },
                    TextRun {
                        text: "cdef".into(),
                        fg: Some(red()),
                        bg: None,
                        attrs: attr::BOLD,
                    },
                ],
            });
        }
        r.tree_mut().append_child(root, t);
        r.compose_tree();

        assert_eq!(ch_at(&r, 0, 0), 'a');
        assert_eq!(ch_at(&r, 3, 0), 'd');
        assert_eq!(ch_at(&r, 0, 1), 'e'); // wrapped onto the next row
        assert_eq!(ch_at(&r, 1, 1), 'f');
        // 'c' belongs to the bold/red run; 'a' to the plain run.
        let c = r.back.get_cell(2, 0).unwrap();
        assert_eq!(c.fg, red());
        assert!(c.attrs & attr::BOLD != 0);
        assert!(r.back.get_cell(0, 0).unwrap().attrs & attr::BOLD == 0);
    }

    #[test]
    fn child_is_clipped_to_parent_content_box() {
        let mut r = Renderer::new(10, 2);
        let root = r.root();
        // Parent: 4 wide, full height, blue.
        let parent = r.tree_mut().create(NodeKind::Box);
        let mut ps = empty_style();
        ps.width = len(4.0);
        ps.height = len(2.0);
        r.tree_mut().set_style(parent, &ps);
        r.tree_mut().get_mut(parent).unwrap().paint.bg = Some(blue());
        // Child: 8 wide (overflows parent), red.
        let child = r.tree_mut().create(NodeKind::Box);
        let mut cs = empty_style();
        cs.width = len(8.0);
        cs.height = len(1.0);
        cs.flex_shrink = 0.0; // keep its 8-cell width so it overflows the parent
        r.tree_mut().set_style(child, &cs);
        r.tree_mut().get_mut(child).unwrap().paint.bg = Some(red());
        r.tree_mut().append_child(parent, child);
        r.tree_mut().append_child(root, parent);
        r.compose_tree();

        // Inside the parent: red shows. Past the parent's right edge: clipped.
        assert_eq!(r.back.get_cell(3, 0).unwrap().bg, red());
        assert_ne!(r.back.get_cell(4, 0).unwrap().bg, red());
        assert_eq!(r.back.get_cell(4, 0).unwrap().bg, DEFAULT_BG);
    }

    #[test]
    fn flush_siblings_share_an_edge_without_gap_or_overlap() {
        // Two grow:1 children of a width-5 row land at 2.5 cells each; rounding
        // both edges keeps them flush — no uncovered seam, no double-painted cell.
        let mut r = Renderer::new(5, 1);
        let root = r.root();
        let a = r.tree_mut().create(NodeKind::Box);
        let b = r.tree_mut().create(NodeKind::Box);
        let mut grow = empty_style();
        grow.flex_grow = 1.0;
        r.tree_mut().set_style(a, &grow);
        r.tree_mut().set_style(b, &grow);
        r.tree_mut().get_mut(a).unwrap().paint.bg = Some(red());
        r.tree_mut().get_mut(b).unwrap().paint.bg = Some(green());
        r.tree_mut().append_child(root, a);
        r.tree_mut().append_child(root, b);
        r.compose_tree();

        // Every column is covered by exactly one sibling (red then green), with
        // a single shared boundary and no DEFAULT_BG gap in between.
        let bgs: Vec<Rgba> = (0..5).map(|x| r.back.get_cell(x, 0).unwrap().bg).collect();
        assert!(bgs.iter().all(|&c| c == red() || c == green()));
        assert_eq!(bgs[0], red());
        assert_eq!(bgs[4], green());
        // exactly one red→green transition
        let transitions = bgs.windows(2).filter(|w| w[0] != w[1]).count();
        assert_eq!(transitions, 1);
    }

    #[test]
    fn emptying_the_tree_clears_its_last_frame() {
        let mut r = Renderer::new(4, 1);
        let root = r.root();
        let a = r.tree_mut().create(NodeKind::Box);
        let mut s = empty_style();
        s.width = len(4.0);
        s.height = len(1.0);
        r.tree_mut().set_style(a, &s);
        r.tree_mut().get_mut(a).unwrap().paint.bg = Some(red());
        r.tree_mut().append_child(root, a);
        r.render_for_test();
        assert_eq!(r.back.get_cell(0, 0).unwrap().bg, red());

        // Remove all content: the next compose must clear the painted frame
        // rather than leave it stale on screen.
        r.tree_mut().remove_child(root, a);
        r.render_for_test();
        assert_eq!(r.back.get_cell(0, 0).unwrap().bg, DEFAULT_BG);
    }

    #[test]
    fn edit_paints_value_and_focused_cursor() {
        let mut r = Renderer::new(10, 1);
        let root = r.root();
        let e = r.tree_mut().create(NodeKind::Edit);
        let mut s = empty_style();
        s.width = len(10.0);
        s.height = len(1.0);
        r.tree_mut().set_style(e, &s);
        {
            let edit = r.tree_mut().get_mut(e).unwrap().edit.as_mut().unwrap();
            edit.insert("hi");
            edit.focused = true; // cursor sits past "hi", at column 2
        }
        r.tree_mut().append_child(root, e);
        r.compose_tree();

        assert_eq!(ch_at(&r, 0, 0), 'h');
        assert_eq!(ch_at(&r, 1, 0), 'i');
        // The block cursor (inverse) is drawn at the cursor column (end of value).
        let cursor = r.back.get_cell(2, 0).unwrap();
        assert!(cursor.attrs & attr::INVERSE != 0, "focused cursor is inverse");
    }

    #[test]
    fn unfocused_empty_edit_shows_placeholder_not_cursor() {
        let mut r = Renderer::new(12, 1);
        let root = r.root();
        let e = r.tree_mut().create(NodeKind::Edit);
        let mut s = empty_style();
        s.width = len(12.0);
        s.height = len(1.0);
        r.tree_mut().set_style(e, &s);
        r.tree_mut().get_mut(e).unwrap().edit.as_mut().unwrap().set_placeholder("name");
        r.tree_mut().append_child(root, e);
        r.compose_tree();

        assert_eq!(ch_at(&r, 0, 0), 'n');
        assert_eq!(ch_at(&r, 3, 0), 'e');
        // No focus → no inverse cursor anywhere on the row.
        let any_inverse = (0..12).any(|x| r.back.get_cell(x, 0).unwrap().attrs & attr::INVERSE != 0);
        assert!(!any_inverse);
    }

    #[test]
    fn edit_scrolls_to_keep_cursor_visible() {
        // Content width 5, value 8 graphemes, cursor at end (col 8): the view
        // scrolls so the tail "defgh" shows and the cursor sits at the right edge.
        let mut r = Renderer::new(5, 1);
        let root = r.root();
        let e = r.tree_mut().create(NodeKind::Edit);
        let mut s = empty_style();
        s.width = len(5.0);
        s.height = len(1.0);
        r.tree_mut().set_style(e, &s);
        {
            let edit = r.tree_mut().get_mut(e).unwrap().edit.as_mut().unwrap();
            edit.insert("abcdefgh");
            edit.focused = true;
        }
        r.tree_mut().append_child(root, e);
        r.compose_tree();

        // scroll = 8 - 5 + 1 = 4, so column 0 shows the 5th grapheme 'e'.
        assert_eq!(ch_at(&r, 0, 0), 'e');
        assert_eq!(ch_at(&r, 3, 0), 'h');
        // Cursor (past 'h') lands on the last visible column, inverse.
        assert!(r.back.get_cell(4, 0).unwrap().attrs & attr::INVERSE != 0);
    }

    #[test]
    fn changing_flex_grow_emits_minimal_diff() {
        let mut r = Renderer::new(6, 1);
        let root = r.root();
        let a = r.tree_mut().create(NodeKind::Box);
        let b = r.tree_mut().create(NodeKind::Box);
        let mut g1 = empty_style();
        g1.flex_grow = 1.0;
        r.tree_mut().set_style(a, &g1);
        r.tree_mut().set_style(b, &g1);
        r.tree_mut().get_mut(a).unwrap().paint.bg = Some(red());
        r.tree_mut().get_mut(b).unwrap().paint.bg = Some(green());
        r.tree_mut().append_child(root, a);
        r.tree_mut().append_child(root, b);
        r.render_for_test();
        r.render_for_test();
        assert!(r.out.is_empty(), "stable tree emits nothing on re-render");

        // Shift the split: only the cells that change color should be emitted.
        let mut g2 = empty_style();
        g2.flex_grow = 2.0;
        r.tree_mut().set_style(a, &g2);
        r.render_for_test();
        assert!(!r.out.is_empty(), "a re-layout must emit the changed cells");
    }
}
