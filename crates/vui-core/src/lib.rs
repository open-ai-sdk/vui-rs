//! vui-core: native core for vui-rs. Owns the rendering heart — a
//! double-buffered cell grid, a minimal-ANSI frame differ, unicode-aware cell
//! width, a taffy flexbox layout + paint pass over a render-node tree, and a C
//! ABI to drive it all from Bun.

pub mod ansi;
pub mod border;
pub mod buffer;
pub mod color;
pub mod edit_buffer;
pub mod ffi;
pub mod layout;
pub mod node;
pub mod paint;
pub mod renderer;
pub mod style;
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
const ABI_VERSION: u32 = 4;

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
