import { FFIType } from "bun:ffi";

/**
 * FFI ABI contract for vui-core. This file is the single source of truth that
 * MUST stay in lockstep with the `#[unsafe(no_mangle)] extern "C"` exports in
 * `crates/vui-core/src/ffi/` and the `#[repr(C)]` `Cell`. Any change here is an
 * ABI change — bump `ABI_VERSION` in `crates/vui-core/src/lib.rs` and
 * `EXPECTED_ABI_VERSION` below together.
 */
export const EXPECTED_ABI_VERSION = 13;

/**
 * Size of one native `Cell` in bytes (`ch:u32, fg:Rgba, bg:Rgba, attrs:u16` +
 * padding). The loader verifies this against `vui_cell_size_bytes()` so a JS
 * typed-array view over the back buffer can never silently mis-stride.
 */
export const CELL_BYTES = 16;

/** Status codes returned by the renderer/buffer exports (`ffi::status`). */
export const Status = {
  OK: 0,
  NULL_PTR: 1,
  PANIC: 2,
  BAD_ARG: 3,
} as const;

/** Text attribute bitflags, mirroring `buffer::attr` on the Rust side. */
export const Attr = {
  BOLD: 1 << 0,
  DIM: 1 << 1,
  ITALIC: 1 << 2,
  UNDERLINE: 1 << 3,
  STRIKETHROUGH: 1 << 4,
  INVERSE: 1 << 5,
  WIDE_CONTINUATION: 1 << 6,
} as const;

/**
 * Bit position of the OSC 8 link id within a cell's `attrs` (mirrors
 * `buffer::attr::LINK_SHIFT`). The high byte holds the id (1..255, 0 = no link);
 * the host ORs `id << LINK_SHIFT` into a run's attrs and the emitter wraps those
 * cells in a hyperlink. Not an SGR flag — kept out of the low byte deliberately.
 */
export const LINK_SHIFT = 8;

/**
 * Size of one packed `StyleFfi` in bytes (7 u32 enums + 2 f32 + 25 DimFfi at 8
 * bytes each = 236). The loader verifies this against `vui_style_ffi_size()`, so
 * a drift between the TS packer (`style.ts`) and the Rust struct fails loud.
 */
export const STYLE_FFI_BYTES = 236;

/** Size of one packed `TextRunFfi` (off/len/fg/bg u32 + attrs u16 + 2×u8 flags). */
export const TEXT_RUN_FFI_BYTES = 20;

/** Size of one `RectFfi` (12 f32: x/y/w/h + padding + border insets). */
export const RECT_FFI_BYTES = 48;

/** Node kinds for `vui_node_new` (mirrors `node::NodeKind::from_u8`). */
export const NodeKindCode = { Box: 1, Text: 2, Edit: 3 } as const;

/** Cursor motion codes for the JS-host edit model (`EditRenderable.move`). */
export const EditMotion = {
  Left: 0,
  Right: 1,
  WordLeft: 2,
  WordRight: 3,
  Home: 4,
  End: 5,
  Up: 6,
  Down: 7,
  DocStart: 8,
  DocEnd: 9,
} as const;
export type EditMotionCode = (typeof EditMotion)[keyof typeof EditMotion];

export const NativeTextWrap = { None: 0, Char: 1, Word: 2 } as const;
export type NativeTextWrapCode =
  (typeof NativeTextWrap)[keyof typeof NativeTextWrap];

export const symbols = {
  // Version / ABI probes.
  vui_version: { args: [], returns: FFIType.u32 },
  vui_abi_version: { args: [], returns: FFIType.u32 },
  // Glyph column width (0/1/2). Useful for JS single-line edit/canvas helpers.
  vui_char_width: { args: [FFIType.u32], returns: FFIType.u32 },

  // Lifecycle.
  vui_renderer_new: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  vui_renderer_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_renderer_resize: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },

  // Zero-copy buffer access. usize crosses as a 64-bit value (returned bigint).
  vui_renderer_back_buffer_ptr: { args: [FFIType.ptr], returns: FFIType.ptr },
  vui_renderer_buffer_len: { args: [FFIType.ptr], returns: "usize" },
  vui_cell_size_bytes: { args: [], returns: "usize" },

  // Draw primitives. Colors are packed 0xRRGGBBAA u32; attrs are u16 bitflags.
  vui_buffer_draw_text: {
    args: [
      FFIType.ptr, // renderer
      FFIType.u32, // x
      FFIType.u32, // y
      FFIType.ptr, // utf-8 bytes
      "usize", // byte length
      FFIType.u32, // fg
      FFIType.u32, // bg
      FFIType.u16, // attrs
    ],
    returns: FFIType.u32,
  },
  vui_buffer_fill_rect: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
    ],
    returns: FFIType.u32,
  },
  vui_buffer_set_cell: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u16,
    ],
    returns: FFIType.u32,
  },
  vui_buffer_clear: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  vui_renderer_render: { args: [FFIType.ptr], returns: FFIType.u32 },
  // JS-host emit: diff/write the back buffer without composing the node tree.
  vui_renderer_flush: { args: [FFIType.ptr], returns: FFIType.u32 },

  // OSC 8 hyperlink table: cleared + re-staged each frame; the emitter wraps cells
  // whose `attrs` high byte equals `id` in the hyperlink. URI crosses as UTF-8
  // bytes (ptr/len); host data only, never user text.
  vui_renderer_clear_links: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_renderer_stage_link: {
    args: [
      FFIType.ptr, // renderer
      FFIType.u16, // link id (1..255)
      FFIType.ptr, // utf-8 URI bytes
      "usize", // byte length
    ],
    returns: FFIType.u32,
  },

  // Raw-emit passthrough: host-built escape bytes emitted out-of-band next frame
  // (image transmit, OSC 52 clipboard). Forces a frame; cleared after emit.
  vui_renderer_stage_passthrough: {
    args: [
      FFIType.ptr, // renderer
      FFIType.ptr, // raw bytes
      "usize", // byte length
    ],
    returns: FFIType.u32,
  },

  // Inline-image decode: path → fitted RGBA8 handle (free with vui_image_free).
  vui_image_decode: {
    args: [
      FFIType.ptr, // utf-8 path bytes
      "usize", // path byte length
      FFIType.u32, // max width px (0 = no resize)
      FFIType.u32, // max height px
    ],
    returns: FFIType.ptr, // *mut DecodedImage (null on error)
  },
  // Kitty Unicode-placeholder placement: image id → on-screen top-left cell, so
  // the emitter can expand each U+10EEEE cell into placeholder + row/col diacritics.
  vui_renderer_stage_image_placement: {
    args: [FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32],
    returns: FFIType.u32,
  },
  vui_renderer_clear_image_placements: { args: [FFIType.ptr], returns: FFIType.u32 },

  vui_image_decode_bytes: {
    args: [
      FFIType.ptr, // image bytes
      "usize", // byte length
      FFIType.u32, // max width px (0 = no resize)
      FFIType.u32, // max height px
    ],
    returns: FFIType.ptr, // *mut DecodedImage (null on error)
  },
  vui_image_width: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_image_height: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_image_rgba_ptr: { args: [FFIType.ptr], returns: FFIType.ptr },
  vui_image_rgba_len: { args: [FFIType.ptr], returns: "usize" },
  vui_image_free: { args: [FFIType.ptr], returns: FFIType.void },

  // Clip-aware back-buffer prims for the JS paint walk. Signed coords; the clip
  // rect crosses as a pointer to a 4-i32 buffer (one 8-byte slot — avoids the
  // platform ABI mis-marshalling 4-byte args spilled onto the stack).
  vui_buffer_draw_text_clipped: {
    args: [
      FFIType.ptr, // renderer
      FFIType.i32, // x
      FFIType.i32, // y
      FFIType.ptr, // utf-8 bytes
      "usize", // byte length
      FFIType.u32, // fg
      FFIType.u32, // bg
      FFIType.u16, // attrs
      FFIType.ptr, // *const ClipRect (Int32Array(4))
    ],
    returns: FFIType.u32,
  },
  vui_buffer_fill_rect_clipped: {
    args: [
      FFIType.ptr,
      FFIType.i32,
      FFIType.i32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
    ],
    returns: FFIType.u32,
  },
  vui_buffer_set_cell_clipped: {
    args: [
      FFIType.ptr,
      FFIType.i32,
      FFIType.i32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u16,
      FFIType.ptr,
    ],
    returns: FFIType.u32,
  },
  // Composite an offscreen buffer (`vui_cbuf_new`) into the back buffer, clipped.
  vui_buffer_blit: {
    args: [
      FFIType.ptr, // renderer
      FFIType.ptr, // *const CellBuffer (offscreen src)
      FFIType.i32, // dst x
      FFIType.i32, // dst y
      FFIType.ptr, // *const ClipRect (Int32Array(4))
    ],
    returns: FFIType.u32,
  },
  vui_buffer_draw_textbuffer: {
    args: [
      FFIType.ptr, // renderer
      FFIType.ptr, // *mut TextBufferView
      FFIType.i32, // x
      FFIType.i32, // y
      FFIType.u32, // fg
      FFIType.u32, // bg
      FFIType.u8, // has bg
      FFIType.u16, // attrs
      FFIType.ptr, // *const ClipRect
    ],
    returns: FFIType.u32,
  },
  vui_buffer_draw_editor: {
    args: [
      FFIType.ptr, // renderer
      FFIType.ptr, // *mut EditorView
      FFIType.i32, // x
      FFIType.i32, // y
      FFIType.u32, // fg
      FFIType.u32, // bg
      FFIType.u32, // cursor bg
      FFIType.u16, // attrs
      FFIType.ptr, // *const ClipRect
    ],
    returns: FFIType.u32,
  },

  // Native text subsystem.
  vui_textbuf_new: { args: [], returns: FFIType.ptr },
  vui_textbuf_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_textbuf_set_text: {
    args: [FFIType.ptr, FFIType.ptr, "usize"],
    returns: FFIType.u32,
  },
  vui_textbuf_set_runs: {
    args: [
      FFIType.ptr, // *mut TextBuffer
      FFIType.ptr, // *const TextRunFfi
      "usize", // run count
      FFIType.ptr, // concatenated utf-8 bytes
      "usize", // byte length
    ],
    returns: FFIType.u32,
  },
  vui_textbuf_line_count: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_textbuf_length: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_textview_new: { args: [FFIType.ptr], returns: FFIType.ptr },
  vui_textview_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_textview_set_wrap: {
    args: [FFIType.ptr, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_textview_set_width: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_textview_measure: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u8, FFIType.ptr],
    returns: FFIType.u32,
  },
  vui_editbuf_new: { args: [], returns: FFIType.ptr },
  vui_editbuf_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_editbuf_set_value: {
    args: [FFIType.ptr, FFIType.ptr, "usize"],
    returns: FFIType.u32,
  },
  vui_editbuf_value_len: { args: [FFIType.ptr], returns: "usize" },
  vui_editbuf_copy_value: {
    args: [FFIType.ptr, FFIType.ptr, "usize"],
    returns: "usize",
  },
  vui_editbuf_insert: {
    args: [FFIType.ptr, FFIType.ptr, "usize"],
    returns: FFIType.u32,
  },
  vui_editbuf_backspace: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_delete: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_newline: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_move: {
    args: [FFIType.ptr, FFIType.u8, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_editbuf_select_all: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_has_selection: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_selected_len: { args: [FFIType.ptr], returns: "usize" },
  vui_editbuf_copy_selected: {
    args: [FFIType.ptr, FFIType.ptr, "usize"],
    returns: "usize",
  },
  vui_editbuf_delete_selection: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.u32,
  },
  vui_editbuf_undo: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_redo: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_can_undo: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_can_redo: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_editbuf_cursor: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.u32,
  },
  vui_editor_new: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  vui_editor_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_editor_set_wrap: {
    args: [FFIType.ptr, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_editor_set_viewport: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_editor_set_focused: {
    args: [FFIType.ptr, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_editor_set_cursor_visible: {
    args: [FFIType.ptr, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_editor_move: {
    args: [FFIType.ptr, FFIType.u8, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_editor_measure: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u8, FFIType.ptr],
    returns: FFIType.u32,
  },

  // Offscreen cell buffer (canvas / buffered nodes). Pointer is *mut CellBuffer.
  vui_cbuf_new: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  vui_cbuf_free: { args: [FFIType.ptr], returns: FFIType.void },
  vui_cbuf_resize: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_cbuf_ptr: { args: [FFIType.ptr], returns: FFIType.ptr },
  vui_cbuf_len: { args: [FFIType.ptr], returns: "usize" },
  vui_cbuf_clear: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  vui_cbuf_draw_text: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
      "usize",
      FFIType.u32,
      FFIType.u32,
      FFIType.u16,
    ],
    returns: FFIType.u32,
  },
  vui_cbuf_fill_rect: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
    ],
    returns: FFIType.u32,
  },
  vui_cbuf_set_cell: {
    args: [
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u32,
      FFIType.u16,
    ],
    returns: FFIType.u32,
  },

  // Render-node tree. Node handles are u32 (0 = null/error).
  vui_renderer_set_root: { args: [FFIType.ptr], returns: FFIType.u32 },
  vui_node_new: { args: [FFIType.ptr, FFIType.u8], returns: FFIType.u32 },
  vui_node_free: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  vui_node_append_child: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_node_insert_before: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_node_remove_child: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_node_set_text: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, "usize"],
    returns: FFIType.u32,
  },
  vui_node_set_text_runs: {
    args: [
      FFIType.ptr, // renderer
      FFIType.u32, // node id
      FFIType.ptr, // *const TextRunFfi
      "usize", // run count
      FFIType.ptr, // concatenated utf-8 bytes
      "usize", // byte length
    ],
    returns: FFIType.u32,
  },
  vui_node_set_text_wrap: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_style: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.u32,
  },
  vui_style_ffi_size: { args: [], returns: "usize" },
  vui_debug_tree_hash: { args: [FFIType.ptr], returns: FFIType.u64 },

  // JS-host layout: run taffy without painting, then read each node's box.
  vui_layout_compute: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_node_rect: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.u32,
  },
} as const;
