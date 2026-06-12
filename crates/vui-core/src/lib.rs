//! vui-core: native core for vui-rs. Owns the rendering heart — a
//! double-buffered cell grid, a minimal-ANSI frame differ, unicode-aware cell
//! width, clip-aware draw primitives + an offscreen buffer, and a taffy flexbox
//! **layout** node tree (style + text-for-measure, read back as rects). Painting
//! lives in the JS host; this exposes a C ABI to drive it all from Bun.

pub mod ansi;
pub mod buffer;
pub mod color;
pub mod ffi;
pub mod image;
pub mod layout;
pub mod node;
pub mod renderer;
pub mod style;
pub mod text;
pub mod width;

use std::panic::catch_unwind;

/// Packed semver of the native core: `(major << 16) | (minor << 8) | patch`.
/// 0.1.0 -> `0x00_01_00`.
const VERSION: u32 = 0x00_01_00;

/// FFI ABI contract version. Bump on ANY change to an exported signature or a
/// `#[repr(C)]` struct layout so the JS loader can refuse a mismatched library.
/// v2: the renderer/buffer exports and the `repr(C)` `Cell`.
/// v3: the render-node tree exports, `StyleFfi`, and `TextRunFfi`.
/// v4: the native edit-buffer exports (`vui_edit_*`) and `NodeKind::Edit`.
/// v5: clip-aware back-buffer prims + blit (`vui_buffer_*_clipped`,
///     `vui_buffer_blit`) and the offscreen cell-buffer surface (`vui_cbuf_*`)
///     for the JS-host paint walk and canvas/buffered nodes.
/// v6: `vui_char_width` — exposed glyph-width source for JS helpers.
/// v7: JS-host layout readback — `vui_layout_compute` + `vui_node_rect` (`RectFfi`)
///     drive taffy for the Renderable tree without painting.
/// v8: `vui_renderer_flush` — diff/emit the back buffer without composing the
///     node tree, so the JS-host paint walk owns the buffer.
/// v9: removed the now-dead Rust paint surface — the node-tree paint walk, the
///     node paint setters (`vui_node_set_bg/fg/attrs/border/title/visible/opacity`),
///     and the native edit-buffer (`vui_edit_*`). The node tree is layout-only.
/// v10: native text subsystem handles (`vui_textbuf_*`, `vui_textview_*`,
///      `vui_editbuf_*`, `vui_editor_*`) plus text-buffer/editor draw exports.
/// v11: native text-buffer styled runs + transparent-bg draw, and `<text>` wrap
///      modes unified on the native TextBufferView.
/// v12: terminal-protocol polish — OSC 8 link table (`vui_renderer_stage_link`,
///      `vui_renderer_clear_links`) with link id in the cell `attrs` high byte, the
///      raw-emit passthrough channel (`vui_renderer_stage_passthrough`) for OSC 52
///      + image transmit, and inline-image decode (`vui_image_*`).
/// v13: `vui_editor_set_cursor_visible` for JS-host textarea cursor blink.
const ABI_VERSION: u32 = 13;

/// Returns the packed semver of the native core.
///
/// `catch_unwind` is the boundary pattern for every FFI export: a panic must
/// never unwind across the C ABI (undefined behaviour). On panic we return a
/// sentinel `0` rather than aborting the host process.
#[unsafe(no_mangle)]
pub extern "C" fn vui_version() -> u32 {
    catch_unwind(|| VERSION).unwrap_or(0)
}

/// Returns the FFI ABI contract version the loaded library was built against.
#[unsafe(no_mangle)]
pub extern "C" fn vui_abi_version() -> u32 {
    catch_unwind(|| ABI_VERSION).unwrap_or(0)
}

/// Terminal column width of a codepoint: 0 (combining/control), 1, or 2. Exposed
/// so JS utilities can use the same glyph-width source as native text layout.
/// A non-codepoint `cp` reports 0. The JS side memoizes per codepoint, so each
/// distinct glyph crosses the boundary at most once.
#[unsafe(no_mangle)]
pub extern "C" fn vui_char_width(cp: u32) -> u32 {
    catch_unwind(|| char::from_u32(cp).map(width::char_width).unwrap_or(0) as u32).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_packed_semver() {
        // 0.1.0 -> 0x00_01_00
        assert_eq!(vui_version(), 0x0000_0100);
    }

    #[test]
    fn abi_version_matches_constant() {
        assert_eq!(vui_abi_version(), ABI_VERSION);
    }

    #[test]
    fn cell_layout_is_stable() {
        // The JS typed-array view assumes a 16-byte Cell. If this changes, bump
        // ABI_VERSION and update the TS-side CELL_BYTES constant.
        assert_eq!(std::mem::size_of::<buffer::Cell>(), 16);
    }
}
