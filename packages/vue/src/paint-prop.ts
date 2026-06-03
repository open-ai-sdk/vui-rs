// Paint props — the visual (non-layout) bucket of patchProp. Each is applied
// immediately via the matching Rust `set_*` (paint setters are cheap and
// idempotent; only layout is coalesced). Multi-arg setters (border, title) read
// companion values from the node's cached `paint` so a partial update keeps the
// rest intact. `border` also reserves a one-cell layout frame so it actually fits.
import { Attr } from "@vui-rs/core";
import { parseColor } from "./color.ts";
import type { VuiHostNode } from "./host-node.ts";

/** Boolean attr props → bit. Numeric `attrs` is handled separately as a base. */
export const ATTR_FLAGS: Record<string, number> = {
  bold: Attr.BOLD,
  dim: Attr.DIM,
  italic: Attr.ITALIC,
  underline: Attr.UNDERLINE,
  strikethrough: Attr.STRIKETHROUGH,
  inverse: Attr.INVERSE,
};

type PaintAlign = "left" | "center" | "right";
type BorderName = "none" | "single" | "double" | "rounded";

/** Apply a paint prop; returns true if the key was a recognised paint prop. */
export function applyPaint(el: VuiHostNode, key: string, next: unknown): boolean {
  const core = el.core;
  if (!core) return false;
  switch (key) {
    case "bg":
    case "backgroundColor":
      core.setBg(parseColor(next));
      return true;
    case "fg":
    case "color":
      core.setFg(parseColor(next));
      return true;
    case "attrs":
      el.paint.baseAttrs = typeof next === "number" ? next : 0;
      core.setAttrs(combineAttrs(el));
      return true;
    case "border":
      applyBorder(el, next);
      return true;
    case "borderColor":
      el.paint.borderColor = parseColor(next);
      core.setBorder(el.paint.border, el.paint.borderColor);
      return true;
    case "title":
      el.paint.title = next == null ? "" : String(next);
      core.setTitle(el.paint.title, el.paint.titleAlign);
      return true;
    case "titleAlign":
      el.paint.titleAlign = (next as PaintAlign) ?? "left";
      core.setTitle(el.paint.title, el.paint.titleAlign);
      return true;
    case "visible":
      core.setVisible(next !== false);
      return true;
    case "opacity":
      core.setOpacity(typeof next === "number" ? next : 1);
      return true;
    case "wrap":
      // `<text>` flow: nowrap on `"nowrap"` or `false`; wrap otherwise (default).
      core.setTextWrap(next === "nowrap" || next === false ? "nowrap" : "wrap");
      return true;
  }
  if (key in ATTR_FLAGS) {
    if (next) el.paint.attrFlags[key] = ATTR_FLAGS[key]!;
    else delete el.paint.attrFlags[key];
    core.setAttrs(combineAttrs(el));
    return true;
  }
  return false;
}

function applyBorder(el: VuiHostNode, next: unknown): void {
  const style: BorderName = next === true ? "single" : !next ? "none" : (next as BorderName);
  el.paint.border = style;
  el.core?.setBorder(style, el.paint.borderColor);
  // A visible border reserves one layout cell on every side so the frame fits.
  (el.styleCache as Record<string, unknown>).border = style === "none" ? 0 : 1;
  el.ctx.dirtyStyle.add(el);
}

function combineAttrs(el: VuiHostNode): number {
  let attrs = el.paint.baseAttrs;
  for (const bit of Object.values(el.paint.attrFlags)) attrs |= bit;
  return attrs >>> 0;
}
