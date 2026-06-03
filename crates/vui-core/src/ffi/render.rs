//! Renderer FFI exports. Colors cross the boundary packed as `0xRRGGBBAA` u32;
//! text crosses as a UTF-8 byte pointer + length. The back buffer can be viewed
//! directly from Bun via `vui_renderer_back_buffer_ptr` for zero-copy writes.

// These are C-ABI entry points: callers (Bun) pass raw pointers by contract.
// Each export null-checks its pointer and runs inside `catch_unwind`, so the
// boundary is sound without an `unsafe fn` signature.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::buffer::{Cell, CellBuffer, ClipRect};
use crate::color::Rgba;
use crate::ffi::status;
use crate::renderer::Renderer;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// Run `f` inside the panic boundary, returning a status code. A null renderer
/// short-circuits to `NULL_PTR`; a panic becomes `PANIC`.
fn with_renderer(r: *mut Renderer, f: impl FnOnce(&mut Renderer) -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        // Safety: pointer originates from `vui_renderer_new` (Box::into_raw) and
        // is checked for null here.
        match unsafe { r.as_mut() } {
            Some(rr) => f(rr),
            None => status::NULL_PTR,
        }
    }))
    .unwrap_or(status::PANIC)
}

/// Allocate a renderer of `w`×`h` cells. Returns null on panic. Free with
/// `vui_renderer_free`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_new(w: u32, h: u32) -> *mut Renderer {
    catch_unwind(|| Box::into_raw(Box::new(Renderer::new(w, h)))).unwrap_or(std::ptr::null_mut())
}

/// Free a renderer. Null is ignored. The pointer must not be used afterwards.
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_free(r: *mut Renderer) {
    if r.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // Safety: pointer came from `vui_renderer_new`; called at most once.
        drop(unsafe { Box::from_raw(r) });
    }));
}

/// Resize the grid and force a full repaint. Invalidates any previously fetched
/// back-buffer pointer — refetch after calling.
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_resize(r: *mut Renderer, w: u32, h: u32) -> u32 {
    with_renderer(r, |rr| {
        rr.resize(w, h);
        status::OK
    })
}

/// Pointer to the back buffer's cells for a zero-copy typed-array view. Valid
/// until the next `vui_renderer_resize` or `vui_renderer_free`. Returns null on
/// a null renderer or panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_back_buffer_ptr(r: *mut Renderer) -> *mut Cell {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_mut() } {
        Some(rr) => rr.back_ptr(),
        None => std::ptr::null_mut(),
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Number of cells in the back buffer (`width * height`). 0 on null/panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_buffer_len(r: *mut Renderer) -> usize {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_ref() } {
        Some(rr) => rr.cell_count(),
        None => 0,
    }))
    .unwrap_or(0)
}

/// Size of one `Cell` in bytes. Lets the JS side compute the typed-array byte
/// length and assert its struct view matches the native layout.
#[unsafe(no_mangle)]
pub extern "C" fn vui_cell_size_bytes() -> usize {
    std::mem::size_of::<Cell>()
}

/// Write UTF-8 `text` (`ptr`/`len`) at `(x, y)`. `fg`/`bg` are packed colors,
/// `attrs` the attribute bitflags.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_draw_text(
    r: *mut Renderer,
    x: u32,
    y: u32,
    ptr: *const u8,
    len: usize,
    fg: u32,
    bg: u32,
    attrs: u16,
) -> u32 {
    with_renderer(r, |rr| {
        if len > 0 && ptr.is_null() {
            return status::NULL_PTR;
        }
        // Safety: caller guarantees `ptr` points to `len` valid bytes; empty
        // text uses a borrowed empty slice so a null/zero-len ptr is fine.
        let bytes = if len == 0 {
            &[][..]
        } else {
            unsafe { std::slice::from_raw_parts(ptr, len) }
        };
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                rr.back_mut()
                    .draw_text(x, y, text, Rgba::from_packed(fg), Rgba::from_packed(bg), attrs);
                status::OK
            }
            Err(_) => status::BAD_ARG,
        }
    })
}

/// Fill a rectangle's background.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_fill_rect(
    r: *mut Renderer,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    bg: u32,
) -> u32 {
    with_renderer(r, |rr| {
        rr.back_mut().fill_rect(x, y, w, h, Rgba::from_packed(bg));
        status::OK
    })
}

/// Set a single cell. `ch` is a Unicode codepoint.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_set_cell(
    r: *mut Renderer,
    x: u32,
    y: u32,
    ch: u32,
    fg: u32,
    bg: u32,
    attrs: u16,
) -> u32 {
    with_renderer(r, |rr| {
        rr.back_mut()
            .set_cell(x, y, ch, Rgba::from_packed(fg), Rgba::from_packed(bg), attrs);
        status::OK
    })
}

/// Clear the whole back buffer to blank cells with the given background.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_clear(r: *mut Renderer, bg: u32) -> u32 {
    with_renderer(r, |rr| {
        rr.back_mut().clear(Rgba::from_packed(bg));
        status::OK
    })
}

/// Diff the back buffer against the screen and write the minimal frame to
/// stdout (wrapped in synchronized output).
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_render(r: *mut Renderer) -> u32 {
    with_renderer(r, |rr| {
        rr.render();
        status::OK
    })
}

/// JS-host emit: diff + write the back buffer as the caller drew it, WITHOUT
/// composing the node tree (the JS paint walk owns the back buffer).
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_flush(r: *mut Renderer) -> u32 {
    with_renderer(r, |rr| {
        rr.flush_only();
        status::OK
    })
}

// --- Clip-aware back-buffer primitives (the JS paint walk's draw surface) ---
//
// Signed coords + an explicit clip rect let the JS host hand a node's content
// box and let the Rust loop drop out-of-bounds cells (one FFI per op, not per
// cell). The clip crosses as a `*const ClipRect` (4 i32 = 16 bytes): a pointer
// is one 8-byte register/slot, sidestepping the platform ABI's mis-marshalling
// of 4-byte stack-passed args once a call spills past the register count.

/// Read a `ClipRect` from a caller pointer (a JS `Int32Array(4)`), or `None` if null.
#[inline]
fn read_clip(clip: *const ClipRect) -> Option<ClipRect> {
    // Safety: `clip` points to 4 i32 (`ClipRect`, repr(C)); null-checked here.
    unsafe { clip.as_ref() }.copied()
}

/// `draw_text` into the back buffer, clipped to `*clip`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_draw_text_clipped(
    r: *mut Renderer,
    x: i32,
    y: i32,
    ptr: *const u8,
    len: usize,
    fg: u32,
    bg: u32,
    attrs: u16,
    clip: *const ClipRect,
) -> u32 {
    with_renderer(r, |rr| {
        let Some(clip) = read_clip(clip) else {
            return status::NULL_PTR;
        };
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
                rr.back_mut().draw_text_clipped(
                    x,
                    y,
                    text,
                    Rgba::from_packed(fg),
                    Rgba::from_packed(bg),
                    attrs,
                    clip,
                );
                status::OK
            }
            Err(_) => status::BAD_ARG,
        }
    })
}

/// `fill_rect` into the back buffer, clipped to `*clip`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_fill_rect_clipped(
    r: *mut Renderer,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    bg: u32,
    clip: *const ClipRect,
) -> u32 {
    with_renderer(r, |rr| {
        let Some(clip) = read_clip(clip) else {
            return status::NULL_PTR;
        };
        rr.back_mut()
            .fill_rect_clipped(x, y, w, h, Rgba::from_packed(bg), clip);
        status::OK
    })
}

/// `set_cell` into the back buffer, clipped to `*clip`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_set_cell_clipped(
    r: *mut Renderer,
    x: i32,
    y: i32,
    ch: u32,
    fg: u32,
    bg: u32,
    attrs: u16,
    clip: *const ClipRect,
) -> u32 {
    with_renderer(r, |rr| {
        let Some(clip) = read_clip(clip) else {
            return status::NULL_PTR;
        };
        rr.back_mut().set_cell_clipped(
            x,
            y,
            ch,
            Rgba::from_packed(fg),
            Rgba::from_packed(bg),
            attrs,
            clip,
        );
        status::OK
    })
}

/// Composite an offscreen `CellBuffer` (`src`, from `vui_cbuf_new`) into the back
/// buffer with its top-left at `(dst_x, dst_y)`, clipped to `*clip`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_buffer_blit(
    r: *mut Renderer,
    src: *const CellBuffer,
    dst_x: i32,
    dst_y: i32,
    clip: *const ClipRect,
) -> u32 {
    with_renderer(r, |rr| {
        let Some(clip) = read_clip(clip) else {
            return status::NULL_PTR;
        };
        // Safety: `src` is a pointer from `vui_cbuf_new`; null-checked here.
        let Some(src) = (unsafe { src.as_ref() }) else {
            return status::NULL_PTR;
        };
        rr.back_mut().blit(src, dst_x, dst_y, clip);
        status::OK
    })
}
