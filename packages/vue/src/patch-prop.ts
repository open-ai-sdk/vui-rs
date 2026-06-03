// Routes a Vue prop to the Rust core. Three buckets: events (`on*`, stored on the
// node for the input layer to dispatch later, no Rust call), layout keys (folded
// into the node's cached `VuiStyle` and flushed as ONE `setStyle` per node), and
// paint keys (applied immediately via the matching `set_*`). A `style` object
// prop is spread through the same dispatch. Every mutation requests a render.
import { parseColor } from "./color.ts";
import { type RunStyle, type VuiHostNode, enclosingText } from "./host-node.ts";
import { ATTR_FLAGS, applyPaint } from "./paint-prop.ts";
import { INSET_SIDES, LAYOUT_KEYS, isEvent } from "./prop-buckets.ts";

let warnedKeys: Set<string> | null = null;

export function patchProp(
  el: VuiHostNode,
  key: string,
  prev: unknown,
  next: unknown,
): void {
  applyProp(el, key, prev, next);
}

function applyProp(el: VuiHostNode, key: string, prev: unknown, next: unknown): void {
  if (key === "style") {
    spreadStyle(el, prev as Record<string, unknown> | null, next as Record<string, unknown> | null);
    return;
  }
  if (key === "class" || key === "className") return; // no CSS classes in a TUI
  if (isEvent(key)) {
    setEvent(el, key, next);
    return;
  }
  if (el.kind === "span") {
    if (applySpanStyle(el, key, next)) {
      const text = enclosingText(el);
      if (text) el.ctx.dirtyText.add(text);
      el.ctx.scheduleRender();
    }
    return;
  }
  if (key === "focusable") {
    setFocusable(el, next !== false);
    return;
  }
  if (key === "focused") {
    setFocused(el, next !== false && next != null);
    el.ctx.scheduleRender();
    return;
  }
  if (el.kind === "edit" && applyEdit(el, key, next)) {
    el.ctx.scheduleRender();
    return;
  }
  if (LAYOUT_KEYS.has(key) || INSET_SIDES.has(key)) {
    applyLayout(el, key, next);
    el.ctx.dirtyStyle.add(el);
  } else if (!applyPaint(el, key, next)) {
    storeUnknown(el, key, next);
  }
  el.ctx.scheduleRender();
}


/** Mark a node as Tab-focusable; releasing focus if it currently holds it. */
function setFocusable(el: VuiHostNode, on: boolean): void {
  el.focusable = on;
  if (!on) el.ctx.focusManager?.release(el);
}

/** Controlled focus: `focused` true focuses the node, false blurs it if focused. */
function setFocused(el: VuiHostNode, on: boolean): void {
  const fm = el.ctx.focusManager;
  if (!fm) return;
  if (on) fm.focus(el);
  else if (fm.current() === el) fm.blur();
}

/** Apply an `<input>`-specific prop straight to its native edit buffer. */
function applyEdit(el: VuiHostNode, key: string, next: unknown): boolean {
  const edit = el.core?.edit;
  if (!edit) return false;
  switch (key) {
    case "value":
      edit.setValue(next == null ? "" : String(next));
      return true;
    case "placeholder":
      edit.setPlaceholder(next == null ? "" : String(next));
      return true;
    case "placeholderColor":
      edit.setPlaceholderColor(parseColor(next));
      return true;
    case "cursorColor":
      edit.setCursorColor(parseColor(next));
      return true;
    case "maxLength":
      edit.setMaxLength(typeof next === "number" ? next : undefined);
      return true;
  }
  return false;
}

function applyLayout(el: VuiHostNode, key: string, next: unknown): void {
  const style = el.styleCache as Record<string, unknown>;
  if (INSET_SIDES.has(key)) {
    const inset = (style.inset as Record<string, unknown> | undefined) ?? {};
    inset[key] = next;
    style.inset = inset;
  } else if (key === "borderWidth") {
    style.border = next;
  } else {
    style[key] = next;
  }
}


/** Apply a style prop to a virtual `span`; returns true if it changed a run style. */
function applySpanStyle(el: VuiHostNode, key: string, next: unknown): boolean {
  const s: RunStyle = el.spanStyle;
  switch (key) {
    case "fg":
    case "color":
      s.fg = parseColor(next);
      return true;
    case "bg":
    case "backgroundColor":
      s.bg = parseColor(next);
      return true;
    case "attrs":
      s.attrs = typeof next === "number" ? next : 0;
      return true;
  }
  if (key in ATTR_FLAGS) {
    if (next) s.attrs |= ATTR_FLAGS[key]!;
    else s.attrs &= ~ATTR_FLAGS[key]!;
    s.attrs >>>= 0;
    return true;
  }
  return false;
}


function spreadStyle(
  el: VuiHostNode,
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): void {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  for (const k of keys) applyProp(el, k, prev?.[k], next?.[k]);
}

function setEvent(el: VuiHostNode, key: string, next: unknown): void {
  const name = key.slice(2).toLowerCase();
  if (typeof next === "function") el.events.set(name, next as (...a: unknown[]) => void);
  else el.events.delete(name);
}

function storeUnknown(el: VuiHostNode, key: string, next: unknown): void {
  el.props[key] = next;
  if (process.env.NODE_ENV !== "production") {
    warnedKeys ??= new Set();
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`vui: unknown prop "${key}" on <${el.tag}> — stored, not applied`);
    }
  }
}
