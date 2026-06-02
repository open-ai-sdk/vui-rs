// Packs a high-level layout style into the flat `StyleFfi` byte buffer the
// native `vui_node_set_style` expects. Field ORDER and offsets here are the ABI
// contract with `crates/vui-core/src/style.rs`; the loader asserts the buffer
// size against `vui_style_ffi_size()`, so a drift fails loud rather than
// silently mis-mapping fields.
//
// Defaults mirror the Rust `StyleFfi::default()` (CSS-initial values): sizes are
// `auto`, margin/padding/border/gap are length-0 (NOT auto — `margin:auto` would
// center/collapse the node), and `inset` is `auto`.

import { STYLE_FFI_BYTES } from "./native/ffi-symbols.ts";

/** A length in cells (number), a percentage, or `auto`. */
export type Dim = number | "auto" | { pct: number };

/** One side value, or per-side values; a scalar applies to all four sides. */
export type Sides = Dim | { left?: Dim; right?: Dim; top?: Dim; bottom?: Dim };

export type AlignValue =
  | "start"
  | "end"
  | "flex-start"
  | "flex-end"
  | "center"
  | "baseline"
  | "stretch";

export type JustifyValue =
  | "start"
  | "end"
  | "flex-start"
  | "flex-end"
  | "center"
  | "space-between"
  | "space-evenly"
  | "space-around";

export interface VuiStyle {
  display?: "flex" | "none";
  position?: "relative" | "absolute";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  alignItems?: AlignValue;
  alignSelf?: AlignValue;
  justifyContent?: JustifyValue;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Dim;
  width?: Dim;
  height?: Dim;
  minWidth?: Dim;
  minHeight?: Dim;
  maxWidth?: Dim;
  maxHeight?: Dim;
  padding?: Sides;
  margin?: Sides;
  border?: Sides;
  inset?: Sides;
  gap?: number | { width?: number; height?: number };
}

const DIM_AUTO = 0;
const DIM_LENGTH = 1;
const DIM_PERCENT = 2;

const DISPLAY = { flex: 0, none: 1 } as const;
const POSITION = { relative: 0, absolute: 1 } as const;
const FLEX_DIR = { row: 0, column: 1, "row-reverse": 2, "column-reverse": 3 } as const;
const FLEX_WRAP = { nowrap: 0, wrap: 1, "wrap-reverse": 2 } as const;
// Shared align/justify code space (mirrors `style::align_code` in Rust).
const ALIGN = {
  start: 1,
  end: 2,
  "flex-start": 3,
  "flex-end": 4,
  center: 5,
  baseline: 6,
  stretch: 7,
  "space-between": 8,
  "space-evenly": 9,
  "space-around": 10,
} as const;

/** Resolve a `Dim` to its `(kind, value)` pair. */
function dimParts(d: Dim): [number, number] {
  if (d === "auto") return [DIM_AUTO, 0];
  if (typeof d === "number") return [DIM_LENGTH, d];
  return [DIM_PERCENT, d.pct];
}

/** Expand a `Sides` shorthand into explicit per-side dims. */
function sides(s: Sides | undefined, fallback: Dim): Record<"left" | "right" | "top" | "bottom", Dim> {
  if (s === undefined) return { left: fallback, right: fallback, top: fallback, bottom: fallback };
  if (typeof s === "number" || s === "auto" || "pct" in s) {
    const d = s as Dim;
    return { left: d, right: d, top: d, bottom: d };
  }
  const o = s as { left?: Dim; right?: Dim; top?: Dim; bottom?: Dim };
  return {
    left: o.left ?? fallback,
    right: o.right ?? fallback,
    top: o.top ?? fallback,
    bottom: o.bottom ?? fallback,
  };
}

/**
 * Pack a `VuiStyle` into the native `StyleFfi` byte layout. Writes every field
 * (seeding CSS defaults for omitted ones) so the buffer never carries stale
 * bytes. Returns a `Uint8Array` to pass as the `*const StyleFfi` pointer arg.
 */
export function packStyle(style: VuiStyle): Uint8Array {
  const buf = new ArrayBuffer(STYLE_FFI_BYTES);
  const view = new DataView(buf);
  let off = 0;
  const u32 = (v: number) => {
    view.setUint32(off, v >>> 0, true);
    off += 4;
  };
  const f32 = (v: number) => {
    view.setFloat32(off, v, true);
    off += 4;
  };
  const dim = (d: Dim) => {
    const [kind, value] = dimParts(d);
    u32(kind);
    f32(value);
  };

  u32(DISPLAY[style.display ?? "flex"]);
  u32(POSITION[style.position ?? "relative"]);
  u32(FLEX_DIR[style.flexDirection ?? "row"]);
  u32(FLEX_WRAP[style.flexWrap ?? "nowrap"]);
  u32(style.alignItems ? ALIGN[style.alignItems] : 0);
  u32(style.alignSelf ? ALIGN[style.alignSelf] : 0);
  u32(style.justifyContent ? ALIGN[style.justifyContent] : 0);
  f32(style.flexGrow ?? 0);
  f32(style.flexShrink ?? 1);
  dim(style.flexBasis ?? "auto");
  dim(style.width ?? "auto");
  dim(style.height ?? "auto");
  dim(style.minWidth ?? "auto");
  dim(style.minHeight ?? "auto");
  dim(style.maxWidth ?? "auto");
  dim(style.maxHeight ?? "auto");

  const pad = sides(style.padding, 0);
  dim(pad.left);
  dim(pad.right);
  dim(pad.top);
  dim(pad.bottom);
  const mar = sides(style.margin, 0);
  dim(mar.left);
  dim(mar.right);
  dim(mar.top);
  dim(mar.bottom);
  const bor = sides(style.border, 0);
  dim(bor.left);
  dim(bor.right);
  dim(bor.top);
  dim(bor.bottom);
  const ins = sides(style.inset, "auto");
  dim(ins.left);
  dim(ins.right);
  dim(ins.top);
  dim(ins.bottom);

  const gapW = typeof style.gap === "number" ? style.gap : (style.gap?.width ?? 0);
  const gapH = typeof style.gap === "number" ? style.gap : (style.gap?.height ?? 0);
  dim(gapW);
  dim(gapH);

  if (off !== STYLE_FFI_BYTES) {
    throw new Error(`packStyle wrote ${off} bytes, expected ${STYLE_FFI_BYTES}`);
  }
  return new Uint8Array(buf);
}
