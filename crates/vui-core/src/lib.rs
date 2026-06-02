//! vui-core: native core for vui-rs (cell buffer, frame diff, ANSI emission,
//! taffy layout and paint). Phase 01 adds the rendering heart: a
//! double-buffered cell grid, a minimal-ANSI frame differ, unicode-aware cell
//! width, and a C ABI to drive it all from Bun.

pub mod ansi;
pub mod buffer;
pub mod color;
pub mod ffi;
pub mod renderer;
pub mod width;

use std::panic::catch_unwind;

/// Packed semver of the native core: `(major << 16) | (minor << 8) | patch`.
/// 0.1.0 -> `0x00_01_00`.
const VERSION: u32 = 0x00_01_00;

/// FFI ABI contract version. Bump on ANY change to an exported signature or a
/// `#[repr(C)]` struct layout so the JS loader can refuse a mismatched library.
/// v2: Phase 01 added the renderer/buffer exports and the `repr(C)` `Cell`.
const ABI_VERSION: u32 = 2;

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
