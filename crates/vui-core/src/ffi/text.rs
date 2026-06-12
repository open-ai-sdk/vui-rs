//! Text subsystem FFI. Pointers are owned handles allocated by this module.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::color::Rgba;
use crate::ffi::status;
use crate::text::{
    EditBuffer, EditMotion, EditorView, StyledRun, TextBuffer, TextBufferView, TextMeasure,
    WrapMode,
};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn ffi_status(f: impl FnOnce() -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(status::PANIC)
}

fn bytes_from<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], u32> {
    if len > 0 && ptr.is_null() {
        return Err(status::NULL_PTR);
    }
    Ok(if len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    })
}

fn str_from<'a>(ptr: *const u8, len: usize) -> Result<&'a str, u32> {
    std::str::from_utf8(bytes_from(ptr, len)?).map_err(|_| status::BAD_ARG)
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TextRunFfi {
    pub text_off: u32,
    pub text_len: u32,
    pub fg: u32,
    pub bg: u32,
    pub attrs: u16,
    pub has_fg: u8,
    pub has_bg: u8,
}

const _: () = assert!(std::mem::size_of::<TextRunFfi>() == 20);

fn opt_color(rgba: u32, has: u8) -> Option<Rgba> {
    if has == 0 {
        None
    } else {
        Some(Rgba::from_packed(rgba))
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_new() -> *mut TextBuffer {
    catch_unwind(|| Box::into_raw(Box::new(TextBuffer::new()))).unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_free(ptr: *mut TextBuffer) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| drop(unsafe { Box::from_raw(ptr) })));
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_set_text(ptr: *mut TextBuffer, bytes: *const u8, len: usize) -> u32 {
    ffi_status(|| {
        let Some(buf) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let text = match str_from(bytes, len) {
            Ok(text) => text,
            Err(code) => return code,
        };
        buf.set_text(text);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_set_runs(
    ptr: *mut TextBuffer,
    runs_ptr: *const TextRunFfi,
    runs_len: usize,
    bytes_ptr: *const u8,
    bytes_len: usize,
) -> u32 {
    ffi_status(|| {
        let Some(buf) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        if (runs_len > 0 && runs_ptr.is_null()) || (bytes_len > 0 && bytes_ptr.is_null()) {
            return status::NULL_PTR;
        }
        let bytes = match bytes_from(bytes_ptr, bytes_len) {
            Ok(bytes) => bytes,
            Err(code) => return code,
        };
        let runs_ffi = if runs_len == 0 {
            &[][..]
        } else {
            unsafe { std::slice::from_raw_parts(runs_ptr, runs_len) }
        };
        let mut decoded = Vec::with_capacity(runs_ffi.len());
        for rf in runs_ffi {
            let start = rf.text_off as usize;
            let end = start.saturating_add(rf.text_len as usize);
            let Some(slice) = bytes.get(start..end) else {
                return status::BAD_ARG;
            };
            let Ok(text) = std::str::from_utf8(slice) else {
                return status::BAD_ARG;
            };
            decoded.push(StyledRun {
                text,
                fg: opt_color(rf.fg, rf.has_fg),
                bg: opt_color(rf.bg, rf.has_bg),
                attrs: rf.attrs,
            });
        }
        buf.set_styled_runs(decoded);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_line_count(ptr: *const TextBuffer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(TextBuffer::line_count)
            .unwrap_or(0) as u32
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textbuf_length(ptr: *const TextBuffer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(TextBuffer::len_graphemes)
            .unwrap_or(0) as u32
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textview_new(buf: *mut TextBuffer) -> *mut TextBufferView {
    catch_unwind(AssertUnwindSafe(|| {
        let buf = unsafe { buf.as_mut() }?;
        Some(Box::into_raw(Box::new(TextBufferView::new(buf))))
    }))
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textview_free(ptr: *mut TextBufferView) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| drop(unsafe { Box::from_raw(ptr) })));
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textview_set_wrap(ptr: *mut TextBufferView, mode: u8) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_wrap(WrapMode::from_u8(mode));
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textview_set_width(ptr: *mut TextBufferView, width: u32) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_width(width);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_textview_measure(
    ptr: *mut TextBufferView,
    width: u32,
    mode: u8,
    out: *mut TextMeasure,
) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let Some(out) = (unsafe { out.as_mut() }) else {
            return status::NULL_PTR;
        };
        *out = view.measure(width, WrapMode::from_u8(mode));
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_new() -> *mut EditBuffer {
    catch_unwind(|| Box::into_raw(Box::new(EditBuffer::new()))).unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_free(ptr: *mut EditBuffer) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| drop(unsafe { Box::from_raw(ptr) })));
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_set_value(ptr: *mut EditBuffer, bytes: *const u8, len: usize) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let text = match str_from(bytes, len) {
            Ok(text) => text,
            Err(code) => return code,
        };
        edit.set_value(text);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_value_len(ptr: *const EditBuffer) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(|e| e.value().len())
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_copy_value(
    ptr: *const EditBuffer,
    out: *mut u8,
    len: usize,
) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(edit) = (unsafe { ptr.as_ref() }) else {
            return 0;
        };
        if len > 0 && out.is_null() {
            return 0;
        }
        let value = edit.value();
        let bytes = value.as_bytes();
        let n = bytes.len().min(len);
        if n > 0 {
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n) };
        }
        n
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_insert(ptr: *mut EditBuffer, bytes: *const u8, len: usize) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let text = match str_from(bytes, len) {
            Ok(text) => text,
            Err(code) => return code,
        };
        edit.insert_text(text);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_backspace(ptr: *mut EditBuffer) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        edit.backspace();
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_delete(ptr: *mut EditBuffer) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        edit.delete();
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_newline(ptr: *mut EditBuffer) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        edit.newline();
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_move(ptr: *mut EditBuffer, motion: u8, selecting: u8) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        edit.move_cursor(EditMotion::from_u8(motion), selecting != 0);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_select_all(ptr: *mut EditBuffer) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        edit.select_all();
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_has_selection(ptr: *const EditBuffer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(|e| if e.has_selection() { 1 } else { 0 })
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_selected_len(ptr: *const EditBuffer) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(|e| e.selected_text().len())
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_copy_selected(
    ptr: *const EditBuffer,
    out: *mut u8,
    len: usize,
) -> usize {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(edit) = (unsafe { ptr.as_ref() }) else {
            return 0;
        };
        if len > 0 && out.is_null() {
            return 0;
        }
        let value = edit.selected_text();
        let bytes = value.as_bytes();
        let n = bytes.len().min(len);
        if n > 0 {
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n) };
        }
        n
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_delete_selection(ptr: *mut EditBuffer, changed: *mut u32) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let Some(changed) = (unsafe { changed.as_mut() }) else {
            return status::NULL_PTR;
        };
        *changed = if edit.delete_selection() { 1 } else { 0 };
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_undo(ptr: *mut EditBuffer, changed: *mut u32) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let Some(changed) = (unsafe { changed.as_mut() }) else {
            return status::NULL_PTR;
        };
        *changed = edit.undo() as u32;
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_redo(ptr: *mut EditBuffer, changed: *mut u32) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        let Some(changed) = (unsafe { changed.as_mut() }) else {
            return status::NULL_PTR;
        };
        *changed = edit.redo() as u32;
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_can_undo(ptr: *const EditBuffer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(|e| e.can_undo() as u32)
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_can_redo(ptr: *const EditBuffer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| {
        unsafe { ptr.as_ref() }
            .map(|e| e.can_redo() as u32)
            .unwrap_or(0)
    }))
    .unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editbuf_cursor(ptr: *const EditBuffer, row: *mut u32, col: *mut u32) -> u32 {
    ffi_status(|| {
        let Some(edit) = (unsafe { ptr.as_ref() }) else {
            return status::NULL_PTR;
        };
        let (Some(row), Some(col)) = (unsafe { row.as_mut() }, unsafe { col.as_mut() }) else {
            return status::NULL_PTR;
        };
        let (r, c) = edit.cursor_row_col();
        *row = r;
        *col = c;
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_new(
    edit: *mut EditBuffer,
    width: u32,
    height: u32,
) -> *mut EditorView {
    catch_unwind(AssertUnwindSafe(|| {
        let edit = unsafe { edit.as_ref() }?;
        Some(Box::into_raw(Box::new(EditorView::new(
            edit, width, height,
        ))))
    }))
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_free(ptr: *mut EditorView) {
    if ptr.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| drop(unsafe { Box::from_raw(ptr) })));
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_set_wrap(ptr: *mut EditorView, mode: u8) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_wrap(WrapMode::from_u8(mode));
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_set_viewport(ptr: *mut EditorView, width: u32, height: u32) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_viewport(width, height);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_set_focused(ptr: *mut EditorView, focused: u8) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_focused(focused != 0);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_set_cursor_visible(ptr: *mut EditorView, visible: u8) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.set_cursor_visible(visible != 0);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_move(ptr: *mut EditorView, motion: u8, selecting: u8) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_mut() }) else {
            return status::NULL_PTR;
        };
        view.move_cursor(EditMotion::from_u8(motion), selecting != 0);
        status::OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_editor_measure(
    ptr: *const EditorView,
    width: u32,
    mode: u8,
    out: *mut TextMeasure,
) -> u32 {
    ffi_status(|| {
        let Some(view) = (unsafe { ptr.as_ref() }) else {
            return status::NULL_PTR;
        };
        let Some(out) = (unsafe { out.as_mut() }) else {
            return status::NULL_PTR;
        };
        *out = view.measure(width, WrapMode::from_u8(mode));
        status::OK
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn textbuf_rejects_null_and_bad_utf8_inputs() {
        assert_eq!(
            vui_textbuf_set_text(std::ptr::null_mut(), std::ptr::null(), 0),
            status::NULL_PTR
        );
        let buf = vui_textbuf_new();
        assert!(!buf.is_null());
        assert_eq!(
            vui_textbuf_set_text(buf, std::ptr::null(), 1),
            status::NULL_PTR
        );
        let bad = [0xff, 0xff];
        assert_eq!(
            vui_textbuf_set_text(buf, bad.as_ptr(), bad.len()),
            status::BAD_ARG
        );
        assert_eq!(vui_textbuf_set_text(buf, b"ok".as_ptr(), 2), status::OK);
        vui_textbuf_free(buf);
    }

    #[test]
    fn textview_measure_checks_pointers() {
        assert_eq!(
            vui_textview_measure(std::ptr::null_mut(), 10, 2, std::ptr::null_mut()),
            status::NULL_PTR
        );
        let buf = vui_textbuf_new();
        let view = vui_textview_new(buf);
        assert!(!view.is_null());
        assert_eq!(
            vui_textview_measure(view, 10, 2, std::ptr::null_mut()),
            status::NULL_PTR
        );
        let mut out = TextMeasure::default();
        assert_eq!(vui_textview_measure(view, 10, 2, &mut out), status::OK);
        vui_textview_free(view);
        vui_textbuf_free(buf);
    }

    #[test]
    fn textview_survives_owner_textbuf_free() {
        let buf = vui_textbuf_new();
        assert_eq!(
            vui_textbuf_set_text(buf, b"hello world".as_ptr(), 11),
            status::OK
        );
        let view = vui_textview_new(buf);
        assert!(!view.is_null());
        vui_textbuf_free(buf);
        let mut out = TextMeasure::default();
        assert_eq!(vui_textview_measure(view, 5, 2, &mut out), status::OK);
        assert_eq!(out.line_count, 2);
        vui_textview_free(view);
    }

    #[test]
    fn editbuf_rejects_bad_inputs_and_null_cursor_outs() {
        assert_eq!(
            vui_editbuf_insert(std::ptr::null_mut(), std::ptr::null(), 0),
            status::NULL_PTR
        );
        let edit = vui_editbuf_new();
        assert!(!edit.is_null());
        assert_eq!(
            vui_editbuf_insert(edit, std::ptr::null(), 1),
            status::NULL_PTR
        );
        let bad = [0xf0, 0x28, 0x8c, 0x28];
        assert_eq!(
            vui_editbuf_insert(edit, bad.as_ptr(), bad.len()),
            status::BAD_ARG
        );
        let mut row = 0;
        assert_eq!(
            vui_editbuf_cursor(edit, &mut row, std::ptr::null_mut()),
            status::NULL_PTR
        );
        let mut col = 0;
        assert_eq!(vui_editbuf_cursor(edit, &mut row, &mut col), status::OK);
        assert_eq!(
            vui_editbuf_undo(edit, std::ptr::null_mut()),
            status::NULL_PTR
        );
        let mut changed = 99;
        assert_eq!(vui_editbuf_undo(edit, &mut changed), status::OK);
        assert_eq!(changed, 0);
        vui_editbuf_free(edit);
    }

    #[test]
    fn editor_survives_owner_editbuf_free() {
        let edit = vui_editbuf_new();
        assert_eq!(vui_editbuf_insert(edit, b"one two".as_ptr(), 7), status::OK);
        let editor = vui_editor_new(edit, 4, 2);
        assert!(!editor.is_null());
        vui_editbuf_free(edit);
        assert_eq!(vui_editor_set_viewport(editor, 4, 2), status::OK);
        vui_editor_free(editor);
    }

    #[test]
    fn editor_rejects_null_edit_handle() {
        assert!(vui_editor_new(std::ptr::null_mut(), 10, 3).is_null());
        assert_eq!(
            vui_editor_set_viewport(std::ptr::null_mut(), 10, 3),
            status::NULL_PTR
        );
        assert_eq!(
            vui_editor_set_wrap(std::ptr::null_mut(), 2),
            status::NULL_PTR
        );
        assert_eq!(
            vui_editor_set_focused(std::ptr::null_mut(), 1),
            status::NULL_PTR
        );
    }
}
