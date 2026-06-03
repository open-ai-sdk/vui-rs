//! Offscreen cell-buffer FFI. A standalone `CellBuffer` (not tied to a renderer)
//! that JS canvas / buffered nodes draw into, then composite into the back buffer
//! with `vui_buffer_blit`. Same boundary contract as the rest of the ABI: null
//! pointers are checked and all work runs inside `catch_unwind`.

// C-ABI entry points: callers pass raw pointers by contract; each export
// null-checks and catches panics, so an `unsafe fn` signature is not needed.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::buffer::{Cell, CellBuffer};
use crate::color::Rgba;
use crate::ffi::status;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Run `f` against a non-null offscreen buffer, returning a status code.
fn with_buffer(b: *mut CellBuffer, f: impl FnOnce(&mut CellBuffer) -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        // Safety: `b` came from `vui_cbuf_new` (Box::into_raw); null-checked here.
        match unsafe { b.as_mut() } {
            Some(bb) => f(bb),
            None => status::NULL_PTR,
        }
    }))
    .unwrap_or(status::PANIC)
}

/// Allocate an offscreen `w`×`h` cell buffer. Null on panic. Free with `vui_cbuf_free`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_new(w: u32, h: u32) -> *mut CellBuffer {
    catch_unwind(|| Box::into_raw(Box::new(CellBuffer::new(w, h)))).unwrap_or(std::ptr::null_mut())
}

/// Free an offscreen buffer. Null is ignored; the pointer must not be reused.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_free(b: *mut CellBuffer) {
    if b.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // Safety: `b` came from `vui_cbuf_new`; called at most once.
        drop(unsafe { Box::from_raw(b) });
    }));
}

/// Reallocate an offscreen buffer to a new size (clears it). Invalidates any
/// previously fetched `vui_cbuf_ptr` — refetch after calling.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_resize(b: *mut CellBuffer, w: u32, h: u32) -> u32 {
    with_buffer(b, |bb| {
        bb.resize(w, h);
        status::OK
    })
}

/// Pointer to the offscreen cells for a zero-copy typed-array view. Valid until
/// the next `vui_cbuf_resize`/`vui_cbuf_free`. Null on a null buffer or panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_ptr(b: *mut CellBuffer) -> *mut Cell {
    catch_unwind(AssertUnwindSafe(|| match unsafe { b.as_mut() } {
        Some(bb) => bb.cells.as_mut_ptr(),
        None => std::ptr::null_mut(),
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Number of cells in an offscreen buffer (`width * height`). 0 on null/panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_len(b: *mut CellBuffer) -> usize {
    catch_unwind(AssertUnwindSafe(|| match unsafe { b.as_ref() } {
        Some(bb) => bb.cells.len(),
        None => 0,
    }))
    .unwrap_or(0)
}

/// Clear an offscreen buffer to blank cells with the given background.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_clear(b: *mut CellBuffer, bg: u32) -> u32 {
    with_buffer(b, |bb| {
        bb.clear(Rgba::from_packed(bg));
        status::OK
    })
}

/// `draw_text` into an offscreen buffer (clipped to its own bounds).
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_draw_text(
    b: *mut CellBuffer,
    x: u32,
    y: u32,
    ptr: *const u8,
    len: usize,
    fg: u32,
    bg: u32,
    attrs: u16,
) -> u32 {
    with_buffer(b, |bb| {
        if len > 0 && ptr.is_null() {
            return status::NULL_PTR;
        }
        // Safety: caller guarantees `ptr` points to `len` valid bytes.
        let bytes = if len == 0 {
            &[][..]
        } else {
            unsafe { std::slice::from_raw_parts(ptr, len) }
        };
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                bb.draw_text(x, y, text, Rgba::from_packed(fg), Rgba::from_packed(bg), attrs);
                status::OK
            }
            Err(_) => status::BAD_ARG,
        }
    })
}

/// `fill_rect` into an offscreen buffer.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_fill_rect(
    b: *mut CellBuffer,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    bg: u32,
) -> u32 {
    with_buffer(b, |bb| {
        bb.fill_rect(x, y, w, h, Rgba::from_packed(bg));
        status::OK
    })
}

/// `set_cell` into an offscreen buffer.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cbuf_set_cell(
    b: *mut CellBuffer,
    x: u32,
    y: u32,
    ch: u32,
    fg: u32,
    bg: u32,
    attrs: u16,
) -> u32 {
    with_buffer(b, |bb| {
        bb.set_cell(x, y, ch, Rgba::from_packed(fg), Rgba::from_packed(bg), attrs);
        status::OK
    })
}
