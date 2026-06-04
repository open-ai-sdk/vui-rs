//! Render-node tree FFI exports. The JS host mirrors the Vue element tree into
//! this Rust tree: it creates nodes, wires parent/child links, and pushes layout
//! style + paint props, all by `NodeId` handle (a `u32`; `0` means null/error).
//!
//! Same boundary contract as `ffi/render.rs`: null pointers are checked, every
//! body runs in `catch_unwind`, and a `u32` status (`ffi::status`) is returned
//! (except constructors, which return a handle and use `0` for failure). Text
//! and titles are stored as data and only ever painted as cells.

// C-ABI entry points: callers pass raw pointers by contract; each export
// null-checks and runs inside `catch_unwind`, so no `unsafe fn` is needed.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

use crate::color::Rgba;
use crate::ffi::status;
use crate::node::{NodeId, NodeKind, TextContent, TextRun};
use crate::renderer::Renderer;
use crate::style::StyleFfi;
use crate::text::WrapMode;
use std::panic::{AssertUnwindSafe, catch_unwind};

/// Run `f` with the renderer, returning a status code. Null renderer →
/// `NULL_PTR`; panic → `PANIC`.
fn with_renderer(r: *mut Renderer, f: impl FnOnce(&mut Renderer) -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_mut() } {
        Some(rr) => f(rr),
        None => status::NULL_PTR,
    }))
    .unwrap_or(status::PANIC)
}

/// Decode an optional packed color: `has == 0` → `None`, else `Some(rgba)`.
fn opt_color(rgba: u32, has: u8) -> Option<Rgba> {
    if has == 0 {
        None
    } else {
        Some(Rgba::from_packed(rgba))
    }
}

/// A styled text run as packed by the JS host. `text_off`/`text_len` index into
/// a separate concatenated UTF-8 byte buffer passed alongside, so one
/// `set_text_runs` call carries N runs + one string blob (no per-run pointers).
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

// The TS packer (`node.ts`) writes run fields at hand-computed offsets assuming a
// 20-byte stride. Fail the build (not at runtime) if a field change drifts that.
const _: () = assert!(std::mem::size_of::<TextRunFfi>() == 20);

/// Return the implicit root node's handle (created with the renderer).
#[unsafe(no_mangle)]
pub extern "C" fn vui_renderer_set_root(r: *mut Renderer) -> u32 {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_ref() } {
        Some(rr) => rr.root().0,
        None => 0,
    }))
    .unwrap_or(0)
}

/// Create a detached node of `kind` (1 = box, 2 = text). Returns its handle, or
/// `0` on failure. Attach it with `vui_node_append_child`/`_insert_before`.
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_new(r: *mut Renderer, kind: u8) -> u32 {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_mut() } {
        Some(rr) => rr.tree_mut().create(NodeKind::from_u8(kind)).0,
        None => 0,
    }))
    .unwrap_or(0)
}

/// Destroy a node and its whole subtree (frees render + taffy nodes). The root
/// cannot be freed. `BAD_ARG` if the handle is stale or refers to the root.
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_free(r: *mut Renderer, id: u32) -> u32 {
    with_renderer(r, |rr| bool_status(rr.tree_mut().free(NodeId(id))))
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_node_append_child(r: *mut Renderer, parent: u32, child: u32) -> u32 {
    with_renderer(r, |rr| {
        bool_status(rr.tree_mut().append_child(NodeId(parent), NodeId(child)))
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_node_insert_before(
    r: *mut Renderer,
    parent: u32,
    child: u32,
    anchor: u32,
) -> u32 {
    with_renderer(r, |rr| {
        bool_status(
            rr.tree_mut()
                .insert_before(NodeId(parent), NodeId(child), NodeId(anchor)),
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn vui_node_remove_child(r: *mut Renderer, parent: u32, child: u32) -> u32 {
    with_renderer(r, |rr| {
        bool_status(rr.tree_mut().remove_child(NodeId(parent), NodeId(child)))
    })
}

/// Set a node's text to a single unstyled run (convenience over `set_text_runs`).
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_set_text(r: *mut Renderer, id: u32, ptr: *const u8, len: usize) -> u32 {
    with_renderer(r, |rr| {
        if len > 0 && ptr.is_null() {
            return status::NULL_PTR;
        }
        let bytes = byte_slice(ptr, len);
        let Ok(text) = std::str::from_utf8(bytes) else {
            return status::BAD_ARG;
        };
        let run = TextRun {
            text: text.to_owned(),
            fg: None,
            bg: None,
            attrs: 0,
        };
        if let Some(node) = rr.tree_mut().get_mut(NodeId(id)) {
            node.text = Some(TextContent { runs: vec![run] });
        } else {
            return status::BAD_ARG;
        }
        // Content drives the node's auto-size, so it must re-measure next layout.
        rr.tree_mut().mark_text_dirty(NodeId(id));
        status::OK
    })
}

/// Set a node's rich text: `runs` styled spans whose text comes from the
/// concatenated UTF-8 `bytes` buffer via each run's `text_off`/`text_len`. A run
/// whose slice is out of range or non-UTF-8 makes the whole call `BAD_ARG` (the
/// node's text is left unchanged).
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_set_text_runs(
    r: *mut Renderer,
    id: u32,
    runs_ptr: *const TextRunFfi,
    runs_len: usize,
    bytes_ptr: *const u8,
    bytes_len: usize,
) -> u32 {
    with_renderer(r, |rr| {
        if (runs_len > 0 && runs_ptr.is_null()) || (bytes_len > 0 && bytes_ptr.is_null()) {
            return status::NULL_PTR;
        }
        let bytes = byte_slice(bytes_ptr, bytes_len);
        // Safety: caller guarantees `runs_ptr` points to `runs_len` valid structs.
        let runs_ffi = if runs_len == 0 {
            &[][..]
        } else {
            unsafe { std::slice::from_raw_parts(runs_ptr, runs_len) }
        };

        let mut runs = Vec::with_capacity(runs_ffi.len());
        for rf in runs_ffi {
            let start = rf.text_off as usize;
            let end = start.saturating_add(rf.text_len as usize);
            let Some(slice) = bytes.get(start..end) else {
                return status::BAD_ARG;
            };
            let Ok(text) = std::str::from_utf8(slice) else {
                return status::BAD_ARG;
            };
            runs.push(TextRun {
                text: text.to_owned(),
                fg: opt_color(rf.fg, rf.has_fg),
                bg: opt_color(rf.bg, rf.has_bg),
                attrs: rf.attrs,
            });
        }
        if let Some(node) = rr.tree_mut().get_mut(NodeId(id)) {
            node.text = Some(TextContent { runs });
        } else {
            return status::BAD_ARG;
        }
        // Content drives the node's auto-size, so it must re-measure next layout.
        rr.tree_mut().mark_text_dirty(NodeId(id));
        status::OK
    })
}

/// Set a text node's wrap mode: 0 = wrap (default), 1 = nowrap. Affects both the
/// auto-size measure pass and paint, so the node is marked dirty to re-measure.
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_set_text_wrap(r: *mut Renderer, id: u32, mode: u8) -> u32 {
    with_renderer(r, |rr| {
        if let Some(node) = rr.tree_mut().get_mut(NodeId(id)) {
            node.wrap = WrapMode::from_u8(mode);
        } else {
            return status::BAD_ARG;
        }
        rr.tree_mut().mark_text_dirty(NodeId(id));
        status::OK
    })
}

/// Apply a packed layout style (`StyleFfi`) to a node in one call.
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_set_style(r: *mut Renderer, id: u32, style: *const StyleFfi) -> u32 {
    with_renderer(r, |rr| {
        let Some(style) = (unsafe { style.as_ref() }) else {
            return status::NULL_PTR;
        };
        bool_status(rr.tree_mut().set_style(NodeId(id), style))
    })
}

/// Size of `StyleFfi` in bytes, so the JS packer can assert its buffer matches
/// the native layout (a drift would silently mis-map every style field).
#[unsafe(no_mangle)]
pub extern "C" fn vui_style_ffi_size() -> usize {
    std::mem::size_of::<StyleFfi>()
}

/// Order-sensitive structural hash of the tree (kind + child order), for JS↔Rust
/// tree-consistency tests. `0` on null/panic.
#[unsafe(no_mangle)]
pub extern "C" fn vui_debug_tree_hash(r: *mut Renderer) -> u64 {
    catch_unwind(AssertUnwindSafe(|| match unsafe { r.as_ref() } {
        Some(rr) => rr.tree().debug_tree_hash(),
        None => 0,
    }))
    .unwrap_or(0)
}

/// A node's computed layout box (cells, fractional) for the JS-host paint walk.
/// 12 f32 = 48 bytes. `x`/`y` are parent-relative; `pad_*`/`border_*` are the
/// taffy insets the paint walk subtracts to reach the content box.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RectFfi {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub pad_left: f32,
    pub pad_right: f32,
    pub pad_top: f32,
    pub pad_bottom: f32,
    pub border_left: f32,
    pub border_right: f32,
    pub border_top: f32,
    pub border_bottom: f32,
}

// The TS reader (`node.ts`) strides this as a 12-float view; fail the build if it drifts.
const _: () = assert!(std::mem::size_of::<RectFfi>() == 48);

/// Run taffy layout over the tree sized to `w`×`h` cells (auto-sizing `<text>`),
/// for the JS host. It then reads each node's box with `vui_node_rect`. This does
/// NOT paint: on the JS-host path the renderer's tree is used for layout only —
/// the JS walk owns the back buffer via the clip-aware draw prims — so the
/// renderer's compose/paint is bypassed entirely. Dirty-gate on the JS side.
#[unsafe(no_mangle)]
pub extern "C" fn vui_layout_compute(r: *mut Renderer, w: u32, h: u32) -> u32 {
    with_renderer(r, |rr| {
        crate::layout::compute(rr.tree_mut(), w, h);
        status::OK
    })
}

/// Write node `id`'s computed box into `*out`. `NULL_PTR` if `out` is null;
/// `BAD_ARG` if the handle is stale or has no layout yet (compute not run).
#[unsafe(no_mangle)]
pub extern "C" fn vui_node_rect(r: *mut Renderer, id: u32, out: *mut RectFfi) -> u32 {
    with_renderer(r, |rr| {
        if out.is_null() {
            return status::NULL_PTR;
        }
        match crate::layout::node_box(rr.tree(), NodeId(id)) {
            Some(b) => {
                let rect = RectFfi {
                    x: b.x,
                    y: b.y,
                    w: b.w,
                    h: b.h,
                    pad_left: b.padding.left,
                    pad_right: b.padding.right,
                    pad_top: b.padding.top,
                    pad_bottom: b.padding.bottom,
                    border_left: b.border.left,
                    border_right: b.border.right,
                    border_top: b.border.top,
                    border_bottom: b.border.bottom,
                };
                // Safety: `out` is non-null (checked) and the caller guarantees it
                // points to a writable `RectFfi`.
                unsafe { *out = rect };
                status::OK
            }
            None => status::BAD_ARG,
        }
    })
}

/// Borrow `len` bytes from `ptr`, or an empty slice when `len == 0` (so a
/// null/zero-length pointer is safe).
fn byte_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        // Safety: caller guarantees `ptr` covers `len` valid bytes.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
}

fn bool_status(ok: bool) -> u32 {
    if ok { status::OK } else { status::BAD_ARG }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_renderer() -> *mut Renderer {
        vui_renderer_new_ptr(20, 6)
    }
    fn vui_renderer_new_ptr(w: u32, h: u32) -> *mut Renderer {
        Box::into_raw(Box::new(Renderer::new(w, h)))
    }
    fn free_renderer(r: *mut Renderer) {
        drop(unsafe { Box::from_raw(r) });
    }

    #[test]
    fn build_tree_over_ffi_and_hash_tracks_structure() {
        let r = new_renderer();
        let root = vui_renderer_set_root(r);
        assert_ne!(root, 0);
        let a = vui_node_new(r, 1); // box
        let b = vui_node_new(r, 2); // text
        assert_ne!(a, 0);
        assert_ne!(b, 0);
        assert_eq!(vui_node_append_child(r, root, a), status::OK);
        assert_eq!(vui_node_append_child(r, root, b), status::OK);
        let h1 = vui_debug_tree_hash(r);
        // Reordering children changes the structural hash.
        assert_eq!(vui_node_remove_child(r, root, a), status::OK);
        assert_eq!(vui_node_append_child(r, root, a), status::OK);
        assert_ne!(h1, vui_debug_tree_hash(r));
        free_renderer(r);
    }

    #[test]
    fn stale_handle_returns_bad_arg_not_panic() {
        let r = new_renderer();
        let a = vui_node_new(r, 1);
        assert_eq!(vui_node_free(r, a), status::OK);
        // Operating on the freed handle is rejected, never a panic across FFI.
        assert_eq!(vui_node_set_text_wrap(r, a, 1), status::BAD_ARG);
        assert_eq!(vui_node_free(r, a), status::BAD_ARG);
        free_renderer(r);
    }

    #[test]
    fn null_renderer_is_handled() {
        assert_eq!(
            vui_node_append_child(std::ptr::null_mut(), 1, 2),
            status::NULL_PTR
        );
        assert_eq!(vui_node_new(std::ptr::null_mut(), 1), 0);
        assert_eq!(vui_debug_tree_hash(std::ptr::null_mut()), 0);
    }

    #[test]
    fn set_text_runs_validates_ranges() {
        let r = new_renderer();
        let t = vui_node_new(r, 2);
        let bytes = b"hello";
        let runs = [TextRunFfi {
            text_off: 0,
            text_len: 5,
            fg: 0,
            bg: 0,
            attrs: 0,
            has_fg: 0,
            has_bg: 0,
        }];
        assert_eq!(
            vui_node_set_text_runs(r, t, runs.as_ptr(), 1, bytes.as_ptr(), bytes.len()),
            status::OK
        );
        // An out-of-range slice is rejected, not read out of bounds.
        let bad = [TextRunFfi {
            text_off: 3,
            text_len: 99,
            fg: 0,
            bg: 0,
            attrs: 0,
            has_fg: 0,
            has_bg: 0,
        }];
        assert_eq!(
            vui_node_set_text_runs(r, t, bad.as_ptr(), 1, bytes.as_ptr(), bytes.len()),
            status::BAD_ARG
        );
        free_renderer(r);
    }

    #[test]
    fn style_ffi_size_is_reported() {
        assert_eq!(vui_style_ffi_size(), std::mem::size_of::<StyleFfi>());
    }
}
