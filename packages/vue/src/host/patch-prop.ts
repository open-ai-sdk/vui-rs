// Routes a Vue prop onto a `Renderable`'s fields. Same three buckets as the FFI
// patch-prop (events / layout / paint), but instead of calling a Rust `set_*` it
// just mutates plain JS state that `renderSelf` (Phase 04) reads. Layout changes
// mark the node in `dirtyLayout`; span/text changes mark the enclosing `<text>`
// in `dirtyText`. The bucket classification is shared via `prop-buckets.ts`.
import { parseColor } from "../color.ts";
import {
  ATTR_FLAGS,
  INSET_SIDES,
  LAYOUT_KEYS,
  isEvent,
} from "../prop-buckets.ts";
import { type EditRenderable } from "./edit-renderable.ts";
import { type Backdrop, type Renderable, type RunStyle } from "./renderable.ts";
import { type TextareaRenderable } from "./textarea-renderable.ts";
import { enclosingText } from "./tree.ts";

let warnedKeys: Set<string> | null = null;

export function patchProp(
  el: Renderable,
  key: string,
  prev: unknown,
  next: unknown,
): void {
  applyProp(el, key, prev, next);
}

function applyProp(
  el: Renderable,
  key: string,
  prev: unknown,
  next: unknown,
): void {
  if (key === "style") {
    spreadStyle(
      el,
      prev as Record<string, unknown> | null,
      next as Record<string, unknown> | null,
    );
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
      el.markDirty();
      el.ctx.scheduleRender();
    }
    return;
  }
  if (key === "focusable") {
    const on = next !== false;
    el.focusable = on;
    if (!on) el.ctx.focusManager?.release(el);
    el.ctx.scheduleRender();
    return;
  }
  if (key === "focused") {
    const on = next !== false && next != null;
    const fm = el.ctx.focusManager;
    if (fm) {
      // Controlled focus via the focus manager (it sets the edit's paint state +
      // fires focus/blur handlers). In offscreen-only tests with no manager, fall
      // back to setting the edit's paint flag directly so the cursor still renders.
      if (on) fm.focus(el);
      else if (fm.current() === el) fm.blur();
    } else if (el.kind === "edit") {
      (el as EditRenderable).edit.focused = on;
      el.markDirty();
    } else if (el.kind === "textarea") {
      (el as TextareaRenderable).textarea.focused = on;
      el.markDirty();
    }
    el.ctx.scheduleRender();
    return;
  }
  if (key === "scrollX" || key === "scrollY") {
    const value =
      typeof next === "number" && Number.isFinite(next)
        ? Math.max(0, Math.floor(next))
        : 0;
    if (el[key] !== value) {
      el[key] = value;
      el.markDirty();
    }
    el.ctx.scheduleRender();
    return;
  }
  if (el.kind === "edit" && applyEdit(el as EditRenderable, key, next)) {
    el.markDirty();
    el.ctx.scheduleRender();
    return;
  }
  if (
    el.kind === "textarea" &&
    applyTextarea(el as TextareaRenderable, key, next)
  ) {
    el.markDirty();
    el.ctx.scheduleRender();
    return;
  }
  if (LAYOUT_KEYS.has(key) || INSET_SIDES.has(key)) {
    applyLayout(el, key, next);
    if (el.kind === "textarea") {
      const textarea = el as TextareaRenderable;
      if (key === "width")
        textarea.textarea.autoWidth = next == null || next === "auto";
      if (key === "height")
        textarea.textarea.autoHeight = next == null || next === "auto";
    }
    el.ctx.dirtyLayout.add(el);
    el.markDirty();
  } else if (!applyPaint(el, key, next)) {
    storeUnknown(el, key, next);
  }
  el.ctx.scheduleRender();
}

/** Apply a paint prop to a Renderable's `paint` state; true if recognised. */
function applyPaint(el: Renderable, key: string, next: unknown): boolean {
  const p = el.paint;
  switch (key) {
    case "bg":
    case "backgroundColor":
      p.bg = parseColor(next);
      return true;
    case "fg":
    case "color":
      p.fg = parseColor(next);
      return true;
    case "attrs":
      p.baseAttrs = typeof next === "number" ? next : 0;
      p.attrs = combineAttrs(p);
      return true;
    case "border":
      applyBorder(el, next);
      return true;
    case "borderColor":
      p.borderColor = parseColor(next);
      return true;
    case "title":
      p.title = next == null ? "" : String(next);
      return true;
    case "titleAlign":
      p.titleAlign = (next as PaintProps["titleAlign"]) ?? "left";
      return true;
    case "visible":
      p.visible = next !== false;
      return true;
    case "opacity":
      p.opacity = typeof next === "number" ? next : 1;
      return true;
    case "zIndex":
    case "z-index":
      p.zIndex =
        typeof next === "number" && Number.isFinite(next) ? Math.trunc(next) : 0;
      return true;
    case "backdrop":
      p.backdrop = parseBackdrop(next);
      return true;
    case "wrap":
      p.wrap =
        next === "nowrap" || next === false
          ? "nowrap"
          : next === "char"
            ? "char"
            : "word";
      // Wrap mode changes the measured size of a `<text>`, so re-measure it.
      if (el.kind === "text") el.ctx.dirtyText.add(el);
      return true;
  }
  if (key in ATTR_FLAGS) {
    if (next) p.attrFlags[key] = ATTR_FLAGS[key]!;
    else delete p.attrFlags[key];
    p.attrs = combineAttrs(p);
    return true;
  }
  return false;
}

type PaintProps = Renderable["paint"];

function applyBorder(el: Renderable, next: unknown): void {
  const style =
    next === true ? "single" : !next ? "none" : (next as PaintProps["border"]);
  el.paint.border = style;
  // A visible border reserves one layout cell per side so the frame fits.
  (el.style as Record<string, unknown>).border = style === "none" ? 0 : 1;
  el.ctx.dirtyLayout.add(el);
}

const DEFAULT_DARKEN = 0.4;

/**
 * Parse the `backdrop` prop into a `Backdrop` (or undefined for off). Accepts
 * `true` (default dim), a number `0..1` (brightness multiplier), or an object
 * `{ darken }`. Anything falsy → no backdrop.
 */
function parseBackdrop(next: unknown): Backdrop | undefined {
  if (next === true) return { darken: DEFAULT_DARKEN };
  if (typeof next === "number" && Number.isFinite(next)) return { darken: next };
  if (next && typeof next === "object") {
    const darken = (next as { darken?: unknown }).darken;
    return { darken: typeof darken === "number" ? darken : DEFAULT_DARKEN };
  }
  return undefined;
}

function combineAttrs(p: PaintProps): number {
  let attrs = p.baseAttrs;
  for (const bit of Object.values(p.attrFlags)) attrs |= bit;
  return attrs >>> 0;
}

function applyEdit(el: EditRenderable, key: string, next: unknown): boolean {
  switch (key) {
    case "value":
      // Route through setValue so the cursor stays valid (clamped to end) — a raw
      // assignment would leave the cursor past the end if the value shrinks.
      el.setValue(next == null ? "" : String(next));
      return true;
    case "placeholder":
      el.edit.placeholder = next == null ? "" : String(next);
      return true;
    case "placeholderColor":
      el.edit.placeholderColor = parseColor(next);
      return true;
    case "cursorColor":
      el.edit.cursorColor = parseColor(next);
      return true;
    case "maxLength":
      el.edit.maxLength = typeof next === "number" ? next : undefined;
      return true;
  }
  return false;
}

function applyTextarea(
  el: TextareaRenderable,
  key: string,
  next: unknown,
): boolean {
  switch (key) {
    case "value":
      {
        const value = next == null ? "" : String(next);
        if (value !== el.getValue()) el.setValue(value);
      }
      return true;
    case "placeholder":
      el.textarea.placeholder = next == null ? "" : String(next);
      return true;
    case "placeholderColor":
      el.textarea.placeholderColor = parseColor(next);
      return true;
    case "cursorColor":
      el.textarea.cursorColor = parseColor(next);
      return true;
    case "wrap":
      el.textarea.wrap =
        next === "nowrap" || next === false
          ? "nowrap"
          : next === "char"
            ? "char"
            : "word";
      el.ctx.dirtyLayout.add(el);
      return true;
    case "tabBehavior":
      el.textarea.tabBehavior = next === "indent" ? "indent" : "focus";
      return true;
    case "tabSize":
      el.textarea.tabSize =
        typeof next === "number" && Number.isFinite(next)
          ? Math.max(1, Math.floor(next))
          : 2;
      return true;
  }
  return false;
}

function applyLayout(el: Renderable, key: string, next: unknown): void {
  const style = el.style as Record<string, unknown>;
  if (INSET_SIDES.has(key)) {
    const cur = style.inset;
    // `inset` may already be a scalar shorthand (e.g. an overlay's default 0, or
    // `:inset="2"`). A per-side override must expand it to an object first —
    // indexing a primitive throws in strict mode. Expanding preserves the scalar
    // on the other three sides.
    const inset: Record<string, unknown> =
      cur != null && typeof cur === "object"
        ? (cur as Record<string, unknown>)
        : { left: cur, right: cur, top: cur, bottom: cur };
    inset[key] = next;
    style.inset = inset;
  } else if (key === "borderWidth") {
    style.border = next;
  } else {
    style[key] = next;
  }
}

function applySpanStyle(el: Renderable, key: string, next: unknown): boolean {
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
  el: Renderable,
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): void {
  const keys = new Set([
    ...Object.keys(prev ?? {}),
    ...Object.keys(next ?? {}),
  ]);
  for (const k of keys) applyProp(el, k, prev?.[k], next?.[k]);
}

function setEvent(el: Renderable, key: string, next: unknown): void {
  // Strip the `on` prefix and a possible `:` (the `on:keyDown` form), then
  // lowercase so `onKeyDown`, `on:keyDown`, and `onKeydown` all map to "keydown".
  const name = key.slice(2).replace(/^:/, "").toLowerCase();
  if (typeof next === "function")
    el.events.set(name, next as (...a: unknown[]) => void);
  else el.events.delete(name);
}

function storeUnknown(el: Renderable, key: string, next: unknown): void {
  el.props[key] = next;
  if (process.env.NODE_ENV !== "production") {
    warnedKeys ??= new Set();
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(
        `vui: unknown prop "${key}" on <${el.tag}> — stored, not applied`,
      );
    }
  }
}
