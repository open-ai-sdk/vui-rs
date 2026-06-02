import { FFIType } from "bun:ffi";

/**
 * FFI ABI contract for vui-core. This file is the single source of truth that
 * MUST stay in lockstep with the `#[unsafe(no_mangle)] extern "C"` exports in
 * `crates/vui-core/src/ffi/` and the `#[repr(C)]` `Cell`. Any change here is an
 * ABI change — bump `ABI_VERSION` in `crates/vui-core/src/lib.rs` and
 * `EXPECTED_ABI_VERSION` below together.
 */
export const EXPECTED_ABI_VERSION = 2;

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

export const symbols = {
  // Version probes (Phase 00).
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
} as const;
