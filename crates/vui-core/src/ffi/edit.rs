//! Native edit-buffer FFI exports — the surface behind `<input>`. The JS host
//! forwards key motions and edits here and reads the value back to sync v-model;
//! no editing logic lives in JS. Same boundary contract as the other FFI modules:
//! null pointers are checked, every body runs in `catch_unwind`, and a `u32`
//! status (`ffi::status`) is returned (except `vui_edit_get_value`, which returns
//! a byte length). An op on a non-`Edit` node is rejected with `BAD_ARG`.

// C-ABI entry points: callers pass raw pointers by contract; each export
// null-checks and runs inside `catch_unwind`, so no `unsafe fn` is needed.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::color::Rgba;
use crate::edit_buffer::{EditBuffer, Motion};
use crate::ffi::status;
use crate::node::NodeId;
use crate::renderer::Renderer;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Resolve the node's `EditBuffer` and run `f`, returning a status code. Null
/// renderer → `NULL_PTR`; missing node or non-edit node → `BAD_ARG`; panic →
/// `PANIC`.
fn with_edit(r: *mut Renderer, id: u32, f: impl FnOnce(&mut EditBuffer) -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_mut() } {
        Some(rr) => match rr.tree_mut().get_mut(NodeId(id)).and_then(|n| n.edit.as_mut()) {
            Some(edit) => f(edit),
            None => status::BAD_ARG,
        },
        None => status::NULL_PTR,
    }))
    .unwrap_or(status::PANIC)
}

/// Borrow `len` bytes from `ptr`, or an empty slice when `len == 0`.
fn byte_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        // Safety: caller guarantees `ptr` covers `len` valid bytes.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

fn opt_color(rgba: u32, has: u8) -> Option<Rgba> {
    if has == 0 {
        None
    } else {
        Some(Rgba::from_packed(rgba))
    }
}

/// Insert UTF-8 `text` at the cursor (segmented into graphemes, clamped to
/// `max_length`, control bytes dropped).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_insert(r: *mut Renderer, id: u32, ptr: *const u8, len: usize) -> u32 {
    if len > 0 && ptr.is_null() {
        return status::NULL_PTR;
    }
    let Ok(text) = std::str::from_utf8(byte_slice(ptr, len)) else {
        return status::BAD_ARG;
    };
    with_edit(r, id, |e| {
        e.insert(text);
        status::OK
    })
}

/// Delete the grapheme before the cursor (Backspace).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_backspace(r: *mut Renderer, id: u32) -> u32 {
    with_edit(r, id, |e| {
        e.backspace();
        status::OK
    })
}

/// Delete the grapheme at the cursor (Delete / forward).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_delete(r: *mut Renderer, id: u32) -> u32 {
    with_edit(r, id, |e| {
        e.delete_forward();
        status::OK
    })
}

/// Move the cursor. `motion`: 0 left, 1 right, 2 word-left, 3 word-right,
/// 4 home, 5 end.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_move(r: *mut Renderer, id: u32, motion: u8) -> u32 {
    with_edit(r, id, |e| {
        e.apply_motion(Motion::from_u8(motion));
        status::OK
    })
}

/// Replace the whole value (v-model write), clamping the cursor to the new end.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_value(r: *mut Renderer, id: u32, ptr: *const u8, len: usize) -> u32 {
    if len > 0 && ptr.is_null() {
        return status::NULL_PTR;
    }
    let Ok(text) = std::str::from_utf8(byte_slice(ptr, len)) else {
        return status::BAD_ARG;
    };
    with_edit(r, id, |e| {
        e.set_value(text);
        status::OK
    })
}

/// Read the value as UTF-8 into `out`/`cap`. Returns the value's full byte length
/// and writes `min(cap, len)` bytes. If the return exceeds `cap`, the value was
/// truncated — the caller should grow its buffer and call again. `0` on
/// null/panic or a non-edit node.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_get_value(r: *mut Renderer, id: u32, out: *mut u8, cap: usize) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(rr) = (unsafe { r.as_mut() }) else {
            return 0;
        };
        let Some(edit) = rr.tree_mut().get_mut(NodeId(id)).and_then(|n| n.edit.as_ref()) else {
            return 0;
        };
        let value = edit.value();
        let bytes = value.as_bytes();
        if !out.is_null() && cap > 0 {
            let n = bytes.len().min(cap);
            // Safety: `out` covers `cap` bytes by contract; `n <= cap`.
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n) };
        }
        bytes.len()
    }))
    .unwrap_or(0)
}

/// Set the cursor to a grapheme index (clamped to the value length).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_cursor(r: *mut Renderer, id: u32, index: u32) -> u32 {
    with_edit(r, id, |e| {
        e.set_cursor(index as usize);
        status::OK
    })
}

/// Set the max grapheme count; `0` means unbounded. Truncates an over-long value.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_max_length(r: *mut Renderer, id: u32, max: u32) -> u32 {
    with_edit(r, id, |e| {
        e.set_max_length(if max == 0 { None } else { Some(max as usize) });
        status::OK
    })
}

/// Set the placeholder shown when the value is empty.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_placeholder(
    r: *mut Renderer,
    id: u32,
    ptr: *const u8,
    len: usize,
) -> u32 {
    if len > 0 && ptr.is_null() {
        return status::NULL_PTR;
    }
    let Ok(text) = std::str::from_utf8(byte_slice(ptr, len)) else {
        return status::BAD_ARG;
    };
    with_edit(r, id, |e| {
        e.set_placeholder(text);
        status::OK
    })
}

/// Set focus (gates cursor rendering): `0` blurred, non-zero focused.
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_focused(r: *mut Renderer, id: u32, focused: u8) -> u32 {
    with_edit(r, id, |e| {
        e.focused = focused != 0;
        status::OK
    })
}

/// Set the block-cursor color. `has == 0` clears it (falls back to inverse video).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_cursor_color(
    r: *mut Renderer,
    id: u32,
    rgba: u32,
    has: u8,
) -> u32 {
    with_edit(r, id, |e| {
        e.cursor_color = opt_color(rgba, has);
        status::OK
    })
}

/// Set the placeholder color. `has == 0` clears it (falls back to dim fg).
#[unsafe(no_mangle)]
pub extern "C" fn vui_edit_set_placeholder_color(
    r: *mut Renderer,
    id: u32,
    rgba: u32,
    has: u8,
) -> u32 {
    with_edit(r, id, |e| {
        e.placeholder_color = opt_color(rgba, has);
        status::OK
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeKind;

    fn new_renderer() -> *mut Renderer {
        Box::into_raw(Box::new(Renderer::new(20, 3)))
    }
    fn free_renderer(r: *mut Renderer) {
        drop(unsafe { Box::from_raw(r) });
    }
    fn new_edit(r: *mut Renderer) -> u32 {
        unsafe { r.as_mut() }.unwrap().tree_mut().create(NodeKind::Edit).0
    }
    fn read_value(r: *mut Renderer, id: u32) -> String {
        let len = vui_edit_get_value(r, id, std::ptr::null_mut(), 0);
        let mut buf = vec![0u8; len];
        let written = vui_edit_get_value(r, id, buf.as_mut_ptr(), buf.len());
        assert_eq!(written, len);
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn insert_motion_delete_round_trips_through_ffi() {
        let r = new_renderer();
        let e = new_edit(r);
        let s = b"hello";
        assert_eq!(vui_edit_insert(r, e, s.as_ptr(), s.len()), status::OK);
        assert_eq!(read_value(r, e), "hello");
        // Home, delete the first char.
        assert_eq!(vui_edit_move(r, e, 4), status::OK); // home
        assert_eq!(vui_edit_delete(r, e), status::OK);
        assert_eq!(read_value(r, e), "ello");
        // End, backspace the last char.
        assert_eq!(vui_edit_move(r, e, 5), status::OK); // end
        assert_eq!(vui_edit_backspace(r, e), status::OK);
        assert_eq!(read_value(r, e), "ell");
        free_renderer(r);
    }

    #[test]
    fn get_value_reports_length_when_buffer_too_small() {
        let r = new_renderer();
        let e = new_edit(r);
        let s = b"abcdef";
        vui_edit_insert(r, e, s.as_ptr(), s.len());
        // Undersized buffer: returns full length, writes only what fits.
        let mut small = [0u8; 3];
        let need = vui_edit_get_value(r, e, small.as_mut_ptr(), small.len());
        assert_eq!(need, 6);
        assert_eq!(&small, b"abc");
        free_renderer(r);
    }

    #[test]
    fn set_value_and_max_length() {
        let r = new_renderer();
        let e = new_edit(r);
        assert_eq!(vui_edit_set_max_length(r, e, 4), status::OK);
        let s = b"truncated";
        vui_edit_set_value(r, e, s.as_ptr(), s.len());
        assert_eq!(read_value(r, e), "trun");
        free_renderer(r);
    }

    #[test]
    fn non_edit_node_and_null_are_rejected() {
        let r = new_renderer();
        let b = unsafe { r.as_mut() }.unwrap().tree_mut().create(NodeKind::Box).0;
        // A box has no edit buffer.
        assert_eq!(vui_edit_backspace(r, b), status::BAD_ARG);
        assert_eq!(vui_edit_get_value(r, b, std::ptr::null_mut(), 0), 0);
        // Null renderer is handled, never a deref.
        assert_eq!(vui_edit_backspace(std::ptr::null_mut(), 1), status::NULL_PTR);
        free_renderer(r);
    }
}
