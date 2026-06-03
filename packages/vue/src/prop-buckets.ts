// Shared prop-routing buckets, used by BOTH the FFI patch-prop and the JS-host
// patch-prop so the two paths classify props identically (the Phase 01 drift
// guard: port, don't fork). Layout keys fold into a node's taffy style; inset
// sides fold into `style.inset`; `on*` keys are events. Everything else is paint.
export const LAYOUT_KEYS = new Set([
  "display", "position", "flexDirection", "flexWrap", "alignItems", "alignSelf",
  "justifyContent", "flexGrow", "flexShrink", "flexBasis", "width", "height",
  "minWidth", "minHeight", "maxWidth", "maxHeight", "padding", "margin", "inset",
  "gap", "borderWidth",
]);

export const INSET_SIDES = new Set(["top", "right", "bottom", "left"]);

export function isEvent(key: string): boolean {
  return key.length > 2 && key[0] === "o" && key[1] === "n" && key[2]! >= "A" && key[2]! <= "Z";
}
