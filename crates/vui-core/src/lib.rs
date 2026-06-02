//! vui-core: native core for vui-rs (cell buffer, frame diff, ANSI emission,
//! taffy layout and paint). Phase 00 exposes only version probes so the full
//! Rust cdylib -> Bun FFI toolchain can be proven end-to-end before any real
//! rendering code exists.

use std::panic::catch_unwind;

/// Packed semver of the native core: `(major << 16) | (minor << 8) | patch`.
/// 0.1.0 -> `0x00_01_00`.
const VERSION: u32 = 0x00_01_00;

/// FFI ABI contract version. Bump on ANY change to an exported signature or a
/// `#[repr(C)]` struct layout so the JS loader can refuse a mismatched library.
const ABI_VERSION: u32 = 1;

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
        assert_eq!(vui_version(), 0x0001_00);
    }

    #[test]
    fn abi_version_matches_constant() {
        assert_eq!(vui_abi_version(), ABI_VERSION);
    }
}
