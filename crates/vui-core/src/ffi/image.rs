//! Inline-image decode FFI. The host passes a path + target pixel box; on success
//! it gets an opaque `*mut DecodedImage` whose RGBA8 bytes it views zero-copy
//! (`vui_image_rgba_ptr` + `vui_image_rgba_len`) to build half-block cells or a
//! base64 graphics transmit. The handle MUST be freed with `vui_image_free`.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::image::{DecodedImage, decode_and_fit, decode_and_fit_bytes};
use std::panic::{AssertUnwindSafe, catch_unwind};

/// Decode `path` (UTF-8 `ptr`/`len`), fit within `max_w`×`max_h` px (0 = no
/// resize), and return an owned handle, or null on any decode/read error or panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_decode(
    ptr: *const u8,
    len: usize,
    max_w: u32,
    max_h: u32,
) -> *mut DecodedImage {
    catch_unwind(AssertUnwindSafe(|| {
        if len == 0 || ptr.is_null() {
            return std::ptr::null_mut();
        }
        // Safety: caller guarantees `ptr` points to `len` valid bytes.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        let Ok(path) = std::str::from_utf8(bytes) else {
            return std::ptr::null_mut();
        };
        match decode_and_fit(path, max_w, max_h) {
            Some(img) => Box::into_raw(Box::new(img)),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Decode an image from in-memory bytes (`ptr`/`len`, format auto-detected) and
/// fit within `max_w`×`max_h` px (0 = no resize). For remote/fetched images the
/// host already holds as bytes. Returns an owned handle, or null on error/panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_decode_bytes(
    ptr: *const u8,
    len: usize,
    max_w: u32,
    max_h: u32,
) -> *mut DecodedImage {
    catch_unwind(AssertUnwindSafe(|| {
        if len == 0 || ptr.is_null() {
            return std::ptr::null_mut();
        }
        // Safety: caller guarantees `ptr` points to `len` valid bytes.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        match decode_and_fit_bytes(bytes, max_w, max_h) {
            Some(img) => Box::into_raw(Box::new(img)),
            None => std::ptr::null_mut(),
        }
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Fitted width in pixels. 0 on a null handle.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_width(img: *const DecodedImage) -> u32 {
    match unsafe { img.as_ref() } {
        Some(i) => i.width,
        None => 0,
    }
}

/// Fitted height in pixels. 0 on a null handle.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_height(img: *const DecodedImage) -> u32 {
    match unsafe { img.as_ref() } {
        Some(i) => i.height,
        None => 0,
    }
}

/// Pointer to the RGBA8 bytes (`width*height*4`) for a zero-copy view. Valid until
/// `vui_image_free`. Null on a null handle.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_rgba_ptr(img: *mut DecodedImage) -> *const u8 {
    match unsafe { img.as_ref() } {
        Some(i) => i.rgba.as_ptr(),
        None => std::ptr::null(),
    }
}

/// Length of the RGBA8 byte buffer. 0 on a null handle.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_rgba_len(img: *const DecodedImage) -> usize {
    match unsafe { img.as_ref() } {
        Some(i) => i.rgba.len(),
        None => 0,
    }
}

/// Free a decoded-image handle. Null is ignored; the pointer must not be reused.
#[unsafe(no_mangle)]
pub extern "C" fn vui_image_free(img: *mut DecodedImage) {
    if img.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // Safety: pointer came from `vui_image_decode` (Box::into_raw), freed once.
        drop(unsafe { Box::from_raw(img) });
    }));
}
