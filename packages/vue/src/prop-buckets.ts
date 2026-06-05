// Shared prop-routing buckets for the host patch-prop. Layout keys fold into a
// node's taffy style; inset sides fold into `style.inset`; `on*` keys are events;
// the boolean attr flags map to attribute bits. Everything else is paint.
import { Attr } from "@vui-rs/core";

/** Boolean attr props → bit. Numeric `attrs` is handled separately as a base. */
export const ATTR_FLAGS: Record<string, number> = {
  bold: Attr.BOLD,
  dim: Attr.DIM,
  italic: Attr.ITALIC,
  underline: Attr.UNDERLINE,
  strikethrough: Attr.STRIKETHROUGH,
  inverse: Attr.INVERSE,
};

export const LAYOUT_KEYS = new Set([
  "display", "position", "flexDirection", "flexWrap", "alignItems", "alignSelf",
  "justifyContent", "flexGrow", "flexShrink", "flexBasis", "width", "height",
  "minWidth", "minHeight", "maxWidth", "maxHeight", "padding", "margin", "inset",
  "gap", "borderWidth",
]);

export const INSET_SIDES = new Set(["top", "right", "bottom", "left"]);

export function isEvent(key: string): boolean {
  if (key.length <= 2 || key[0] !== "o" || key[1] !== "n") return false;
  // `onKeyDown` (standard) OR `on:keyDown` — the Vue template compiler emits the
  // colon form for a camelCase event arg on a custom element (`@keyDown`), so we
  // must accept both or such handlers silently drop.
  return key[2] === ":" || (key[2]! >= "A" && key[2]! <= "Z");
}
