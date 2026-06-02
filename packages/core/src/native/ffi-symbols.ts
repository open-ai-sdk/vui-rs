import { FFIType } from "bun:ffi";

/**
 * FFI ABI contract for vui-core. This file is the single source of truth that
 * MUST stay in lockstep with the `#[unsafe(no_mangle)] extern "C"` exports in
 * `crates/vui-core/src/ffi/` and the `#[repr(C)]` `Cell`. Any change here is an
 * ABI change — bump `ABI_VERSION` in `crates/vui-core/src/lib.rs` and
 * `EXPECTED_ABI_VERSION` below together.
 */
export const EXPECTED_ABI_VERSION = 3;

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
 * Size of one packed `StyleFfi` in bytes (7 u32 enums + 2 f32 + 25 DimFfi at 8
 * bytes each = 236). The loader verifies this against `vui_style_ffi_size()`, so
 * a drift between the TS packer (`style.ts`) and the Rust struct fails loud.
 */
export const STYLE_FFI_BYTES = 236;

/** Size of one packed `TextRunFfi` (off/len/fg/bg u32 + attrs u16 + 2×u8 flags). */
export const TEXT_RUN_FFI_BYTES = 20;

/** Node kinds for `vui_node_new` (mirrors `node::NodeKind::from_u8`). */
export const NodeKindCode = { Box: 1, Text: 2 } as const;

/** Border styles for `vui_node_set_border` (0 = none). */
export const BorderStyleCode = { None: 0, Single: 1, Double: 2, Rounded: 3 } as const;

/** Title alignment for `vui_node_set_title`. */
export const TitleAlignCode = { Left: 0, Center: 1, Right: 2 } as const;

export const symbols = {
  // Version / ABI probes.
  vui_version: { args: [], returns: FFIType.u32 },
  vui_abi_version: { args: [], returns: FFIType.u32 },

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
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.u32,
  },
  vui_buffer_set_cell: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u16],
    returns: FFIType.u32,
  },
  vui_buffer_clear: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  vui_renderer_render: { args: [FFIType.ptr], returns: FFIType.u32 },

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
  vui_node_set_bg: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_fg: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_attrs: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u16],
    returns: FFIType.u32,
  },
  vui_node_set_border: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u8, FFIType.u32, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_title: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, "usize", FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_visible: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u8],
    returns: FFIType.u32,
  },
  vui_node_set_opacity: {
    args: [FFIType.ptr, FFIType.u32, FFIType.f32],
    returns: FFIType.u32,
  },
  vui_node_set_style: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.u32,
  },
  vui_style_ffi_size: { args: [], returns: "usize" },
  vui_debug_tree_hash: { args: [FFIType.ptr], returns: FFIType.u64 },
} as const;
