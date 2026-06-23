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
use crate::buffer::{Cell, CellBuffer, attr};
use crate::color::Rgba;
use crate::node::{NodeId, NodeTree};
use std::collections::HashMap;
use std::io::Write;
use std::time::{Duration, Instant};

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
    /// The layout node tree. The JS host pushes styles + text-for-measure onto it,
    /// runs `layout::compute`, and reads each node's box back — it does not paint
    /// the tree (painting lives in the JS host, emitted via `flush_only`).
    tree: NodeTree,
    /// OSC 8 link id → URI, staged by the host each frame. The emitter wraps runs
    /// of equal-link-id cells in a hyperlink. Host-owned data only (never user
    /// text), so it can't break the cell-text injection-safety invariant.
    links: HashMap<u16, String>,
    /// Raw escape bytes the host stages to emit out-of-band this frame (image
    /// transmit, OSC 52 clipboard). Written verbatim inside the synchronized-output
    /// wrapper before the cell diff, then cleared. Host-built sequences ONLY — user
    /// text never enters this channel, so the cell injection-safety invariant holds.
    /// A non-empty channel forces a frame even when no cell changed, so a one-shot
    /// sequence (e.g. a clipboard write) always lands.
    passthrough: Vec<u8>,
    /// Image id → on-screen top-left cell `(x0, y0)` for Kitty Unicode-placeholder
    /// placement. The emitter expands a `U+10EEEE` cell into the placeholder char +
    /// row/col diacritics from the cell's offset to this origin; the image id is
    /// decoded from the cell's foreground color. Host-staged each frame.
    image_placements: HashMap<u32, (i32, i32)>,
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
            links: HashMap::new(),
            passthrough: Vec::new(),
            image_placements: HashMap::new(),
        }
    }

    /// Append raw escape bytes to emit out-of-band on the next frame (image
    /// transmit, OSC 52). Host-built sequences only — never user text. Multiple
    /// stages in one frame concatenate in call order.
    pub fn stage_passthrough(&mut self, bytes: &[u8]) {
        self.passthrough.extend_from_slice(bytes);
    }

    /// Register the on-screen top-left of an image's Unicode-placeholder block, so
    /// the emitter can compute each placeholder cell's image row/column.
    pub fn stage_image_placement(&mut self, id: u32, x0: i32, y0: i32) {
        self.image_placements.insert(id, (x0, y0));
    }

    /// Drop all image placements (host calls this before re-staging a frame).
    pub fn clear_image_placements(&mut self) {
        self.image_placements.clear();
    }

    /// Replace the OSC 8 link table entry for `id` (host stages this each frame
    /// before flush). `id` 0 is reserved for "no link" and ignored.
    pub fn stage_link(&mut self, id: u16, uri: String) {
        if id != 0 {
            self.links.insert(id, uri);
        }
    }

    /// Drop all staged OSC 8 links (host calls this before re-staging a frame).
    pub fn clear_links(&mut self) {
        self.links.clear();
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
        // The OSC 8 link currently open in the byte stream (0 = none). Links never
        // span a cursor jump or a row boundary — both reset it via a close.
        let mut cur_link: u16 = 0;
        let mut utf8 = [0u8; 4];

        // Out-of-band passthrough: emit host-staged raw escapes first, inside the
        // sync wrapper. Forces a frame even with no cell change so a one-shot
        // sequence (clipboard write, image transmit) is never dropped.
        if !self.passthrough.is_empty() {
            ansi::sync_begin(&mut self.out);
            ansi::hide_cursor(&mut self.out);
            frame_started = true;
            // Disjoint fields: `out` borrowed mut, `passthrough` borrowed read.
            self.out.extend_from_slice(&self.passthrough);
            self.passthrough.clear();
        }

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
                    // A hyperlink must not span a cursor jump (it would underline
                    // the gap): close it before moving, reopen on the next cell.
                    if cur_link != 0 {
                        ansi::osc8_close(&mut self.out);
                        cur_link = 0;
                    }
                    ansi::move_to(&mut self.out, x, y);
                }

                let want = Pen {
                    fg: back.fg,
                    bg: back.bg,
                    // Mask out the link id (high byte): it's not SGR, so a link
                    // boundary alone must not force a color re-emit.
                    attrs: back.attrs & attr::SGR_MASK,
                };
                if pen != Some(want) {
                    ansi::reset(&mut self.out);
                    ansi::fg(&mut self.out, want.fg);
                    ansi::bg(&mut self.out, want.bg);
                    ansi::attributes(&mut self.out, want.attrs);
                    pen = Some(want);
                }

                // OSC 8 hyperlink boundary: open/close around runs of equal link id.
                let link = attr::link_id(back.attrs);
                if link != cur_link {
                    if cur_link != 0 {
                        ansi::osc8_close(&mut self.out);
                    }
                    // Only enter the "open" state if a link actually opened — an id
                    // with no staged URI emits nothing, so it must not later trigger
                    // an unbalanced close.
                    let mut opened = 0;
                    if link != 0 {
                        if let Some(uri) = self.links.get(&link) {
                            ansi::osc8_open(&mut self.out, uri);
                            opened = link;
                        }
                    }
                    cur_link = opened;
                }

                // Kitty image placeholder: expand the cell into the placeholder
                // char + row/col diacritics. The foreground (already emitted by the
                // pen) carries the image id; the placement registry gives the
                // image's on-screen origin so we can derive this cell's row/col.
                if back.ch == ansi::KITTY_PLACEHOLDER {
                    let id = (((back.fg.r as u32) << 16)
                        | ((back.fg.g as u32) << 8)
                        | (back.fg.b as u32))
                        & 0x00ff_ffff;
                    if let Some(&(px0, py0)) = self.image_placements.get(&id) {
                        let row = (y as i64 - py0 as i64).max(0) as usize;
                        let col = (x as i64 - px0 as i64).max(0) as usize;
                        ansi::kitty_placeholder(&mut self.out, row, col);
                    } else {
                        // No placement staged: emit the bare placeholder (renders
                        // as nothing) rather than a stray glyph.
                        let mut u = [0u8; 4];
                        self.out.extend_from_slice(
                            char::from_u32(ansi::KITTY_PLACEHOLDER)
                                .unwrap()
                                .encode_utf8(&mut u)
                                .as_bytes(),
                        );
                    }
                    cursor_col = x as i64 + 1;
                    continue;
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
            if cur_link != 0 {
                ansi::osc8_close(&mut self.out);
            }
            ansi::reset(&mut self.out);
            ansi::sync_end(&mut self.out);
        }

        // Sync the screen state for the next diff. One memcpy, no allocation.
        self.front.cells.copy_from_slice(&self.back.cells);
        self.force = false;
    }

    /// Diff the back buffer (as the JS host drew it) against the screen and write
    /// the minimal frame to stdout under a synchronized-output wrapper. The host
    /// clears + stamps the back buffer via the clip-aware draw prims, then calls
    /// this to emit. (`render` is kept as an alias of `flush_only` for the FFI.)
    pub fn flush_only(&mut self) {
        if crate::perf::enabled() {
            // Split the compose/diff/ANSI-byte build (`paint`) from the stdout
            // write+flush (`emit`) so an emit-bound frame (slow/SSH terminal) is
            // distinguishable from a compose-bound one.
            let p0 = Instant::now();
            self.paint();
            let paint = p0.elapsed();
            let nbytes = self.out.len();
            if self.out.is_empty() {
                crate::perf::record_paint(paint, Duration::ZERO, 0);
                return;
            }
            let e0 = Instant::now();
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            let _ = lock.write_all(&self.out);
            let _ = lock.flush();
            crate::perf::record_paint(paint, e0.elapsed(), nbytes);
            return;
        }
        self.paint();
        if self.out.is_empty() {
            return;
        }
        let stdout = std::io::stdout();
        let mut lock = stdout.lock();
        let _ = lock.write_all(&self.out);
        let _ = lock.flush();
    }

    /// Alias of `flush_only` (kept so the existing `vui_renderer_render` export and
    /// the immediate-mode draw path keep emitting). There is no tree compose now.
    pub fn render(&mut self) {
        self.flush_only();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{DEFAULT_BG, DEFAULT_FG, attr};

    fn red() -> Rgba {
        Rgba::new(255, 0, 0, 255)
    }

    #[test]
    fn first_frame_emits_sync_wrapper_and_content() {
        let mut r = Renderer::new(4, 1);
        r.back_mut()
            .draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.starts_with("\x1b[?2026h"));
        assert!(s.ends_with("\x1b[?2026l"));
        assert!(s.contains("Hi"));
    }

    #[test]
    fn unchanged_frame_emits_nothing() {
        let mut r = Renderer::new(4, 1);
        r.back_mut()
            .draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint(); // first paint clears force and syncs front
        r.paint(); // identical back vs front
        assert!(r.out.is_empty(), "no-op frame should emit zero bytes");
    }

    #[test]
    fn only_changed_cells_are_emitted() {
        let mut r = Renderer::new(5, 1);
        r.back_mut()
            .draw_text(0, 0, "abcde", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        // Change a single cell in the middle.
        r.back_mut()
            .set_cell(2, 0, 'X' as u32, DEFAULT_FG, DEFAULT_BG, 0);
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
        r.back_mut()
            .set_cell(0, 0, 'a' as u32, red(), DEFAULT_BG, 0);
        r.back_mut()
            .set_cell(1, 0, 'b' as u32, red(), DEFAULT_BG, attr::BOLD);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.contains("\x1b[1m")); // bold applied on the second cell
    }

    #[test]
    fn wide_char_skips_continuation_cell() {
        let mut r = Renderer::new(4, 1);
        r.back_mut()
            .draw_text(0, 0, "世a", DEFAULT_FG, DEFAULT_BG, 0);
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
        r.back_mut()
            .draw_text(0, 0, "世", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.back_mut()
            .set_cell(1, 0, 'x' as u32, DEFAULT_FG, DEFAULT_BG, 0);
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
        r.back_mut()
            .draw_text(0, 0, "世", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.back_mut()
            .set_cell(0, 0, 'a' as u32, DEFAULT_FG, DEFAULT_BG, 0);
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
        r.back_mut()
            .set_cell(1, 0, '世' as u32, DEFAULT_FG, DEFAULT_BG, 0);
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
    fn passthrough_emits_inside_sync_wrapper_and_clears() {
        let mut r = Renderer::new(4, 1);
        r.back_mut()
            .draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint(); // first paint syncs front, drains nothing staged
        // Stage a raw sequence with NO cell change: it must still emit, forced.
        r.stage_passthrough(b"\x1b]52;c;Zm9v\x07");
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(s.starts_with("\x1b[?2026h"), "frame opens with sync begin");
        assert!(s.contains("\x1b]52;c;Zm9v\x07"), "staged bytes are emitted");
        assert!(s.ends_with("\x1b[?2026l"), "frame closes with sync end");
        // Channel cleared: a following paint with nothing staged emits nothing.
        r.paint();
        assert!(
            r.out.is_empty(),
            "passthrough must not persist across frames"
        );
    }

    #[test]
    fn kitty_placeholder_cell_expands_with_diacritics() {
        let mut r = Renderer::new(3, 2);
        // Image id 7 placed at top-left (0,0). fg encodes the id as RGB (0,0,7).
        r.stage_image_placement(7, 0, 0);
        let id_fg = Rgba::new(0, 0, 7, 255);
        // A placeholder cell at (2,1): image row 1, col 2.
        r.back_mut()
            .set_cell(2, 1, ansi::KITTY_PLACEHOLDER, id_fg, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        // The placeholder base char is emitted…
        assert!(s.contains('\u{10EEEE}'), "placeholder char missing");
        // …followed by the row(1) then col(2) diacritics for this cell.
        assert!(s.contains('\u{030D}'), "row diacritic (index 1) missing"); // DIACRITICS[1]
        assert!(s.contains('\u{030E}'), "col diacritic (index 2) missing"); // DIACRITICS[2]
        // The id is carried as a truecolor foreground.
        assert!(s.contains("\x1b[38;2;0;0;7m"), "image-id fg color missing");
    }

    #[test]
    fn osc8_link_wraps_linked_cells() {
        let mut r = Renderer::new(6, 1);
        r.stage_link(1, "https://x.io".into());
        // Two cells carrying link id 1 (high byte), then a plain cell.
        let linked = (1u16 << attr::LINK_SHIFT) | 0;
        r.back_mut()
            .set_cell(0, 0, 'a' as u32, DEFAULT_FG, DEFAULT_BG, linked);
        r.back_mut()
            .set_cell(1, 0, 'b' as u32, DEFAULT_FG, DEFAULT_BG, linked);
        r.back_mut()
            .set_cell(2, 0, 'c' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        // Exactly one open (run of 2 linked cells) + one close, URI present.
        assert_eq!(s.matches("\x1b]8;;https://x.io\x1b\\").count(), 1);
        assert_eq!(s.matches("\x1b]8;;\x1b\\").count(), 1);
        // The link closes before the plain cell 'c'.
        let open_at = s.find("https://x.io").unwrap();
        let close_at = s.find("\x1b]8;;\x1b\\").unwrap();
        let c_at = s.rfind('c').unwrap();
        assert!(open_at < close_at && close_at < c_at);
    }

    #[test]
    fn osc8_link_id_without_staged_uri_emits_no_unbalanced_close() {
        let mut r = Renderer::new(3, 1);
        // No URI staged for id 1: the linked cells must emit NEITHER an open nor a
        // close (an unbalanced close would corrupt link state on the terminal).
        let linked = 1u16 << attr::LINK_SHIFT;
        r.back_mut()
            .set_cell(0, 0, 'a' as u32, DEFAULT_FG, DEFAULT_BG, linked);
        r.back_mut()
            .set_cell(1, 0, 'b' as u32, DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        assert!(
            !s.contains("\x1b]8;;"),
            "no OSC 8 sequence for an unstaged link id"
        );
    }

    #[test]
    fn osc8_uri_strips_control_bytes() {
        let mut r = Renderer::new(2, 1);
        // A malicious href with an embedded clear-screen escape must be neutered.
        r.stage_link(1, "h\x1b[2Jp".into());
        let linked = 1u16 << attr::LINK_SHIFT;
        r.back_mut()
            .set_cell(0, 0, 'x' as u32, DEFAULT_FG, DEFAULT_BG, linked);
        r.paint();
        let s = String::from_utf8_lossy(&r.out);
        // The ESC is stripped, breaking the contiguous clear-screen sequence; the
        // printable tail survives as harmless URI text (same rule as `safe_glyph`).
        assert!(
            !s.contains("\x1b[2J"),
            "control bytes leaked through OSC 8 URI"
        );
        assert!(s.contains("h[2Jp"), "printable URI chars should survive");
    }

    #[test]
    fn resize_forces_full_redraw() {
        let mut r = Renderer::new(4, 1);
        r.back_mut()
            .draw_text(0, 0, "Hi", DEFAULT_FG, DEFAULT_BG, 0);
        r.paint();
        r.paint();
        assert!(r.out.is_empty());
        r.resize(6, 2);
        r.paint(); // even an all-blank buffer repaints fully after resize
        assert!(!r.out.is_empty());
    }
}
