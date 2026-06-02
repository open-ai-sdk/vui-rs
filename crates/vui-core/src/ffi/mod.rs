//! C ABI surface. Every exported function follows the same boundary contract:
//! null pointers are checked, all work runs inside `catch_unwind` so a panic
//! becomes an error status instead of unwinding across the ABI (UB), and a
//! `u32` status code (`status` module) is returned where applicable.

pub mod node;
pub mod render;

/// FFI status codes shared by the exported functions.
pub mod status {
    pub const OK: u32 = 0;
    /// A required `*mut Renderer` (or other pointer) argument was null.
    pub const NULL_PTR: u32 = 1;
    /// The call panicked and was caught at the boundary.
    pub const PANIC: u32 = 2;
    /// An argument was malformed (e.g. non-UTF-8 text bytes).
    pub const BAD_ARG: u32 = 3;
}
