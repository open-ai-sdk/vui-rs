// Per-app focus model for the JS host — the twin of the FFI host's focus.ts, but
// over `Renderable`s. Focus order is the DFS of the tree filtered to `focusable`
// nodes, recomputed per move (no stale registry). One node is focused at a time;
// Tab/Shift-Tab cycle it; a key/paste event dispatches to the focused node then
// bubbles to ancestors, stopping on `preventDefault()`.
import type { InputEvent } from "@vui-rs/core";
import { type EditRenderable } from "./edit-renderable.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { type TextareaRenderable } from "./textarea-renderable.ts";

/** An input event as seen by handlers — augmented with bubble control. */
export type DispatchableEvent = InputEvent & {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

export interface HostFocusManager {
  focus(node: Renderable): void;
  blur(): void;
  focusNext(): void;
  focusPrev(): void;
  current(): Renderable | null;
  /** Drop a node from focus if it currently holds it (called when it unmounts). */
  release(node: Renderable): void;
  /** Route a key/paste event to the focused node, then bubble to ancestors. */
  dispatch(ev: InputEvent): void;
}

export function createHostFocusManager(ctx: HostContext): HostFocusManager {
  let current: Renderable | null = null;

  /** Focusable nodes in DFS (tab) order, walked from the app root. */
  function order(): Renderable[] {
    const out: Renderable[] = [];
    const visit = (node: Renderable | null): void => {
      if (!node) return;
      if (node.focusable) out.push(node);
      for (const child of node.children) visit(child);
    };
    visit(ctx.root);
    return out;
  }

  function setFocused(node: Renderable, on: boolean): void {
    if (node.kind === "edit") (node as EditRenderable).edit.focused = on;
    else if (node.kind === "textarea") (node as TextareaRenderable).textarea.focused = on;
    node.events.get(on ? "focus" : "blur")?.();
  }

  function focus(node: Renderable): void {
    if (current === node) return;
    if (current) setFocused(current, false);
    current = node;
    setFocused(node, true);
    ctx.scheduleRender();
  }

  function blur(): void {
    if (!current) return;
    setFocused(current, false);
    current = null;
    ctx.scheduleRender();
  }

  function step(delta: 1 | -1): void {
    const list = order();
    if (list.length === 0) return;
    const at = current ? list.indexOf(current) : -1;
    const next = list[(at + delta + list.length) % list.length]!;
    focus(next);
  }

  function dispatch(ev: InputEvent): void {
    if (!current) return;
    const d = ev as DispatchableEvent;
    d.defaultPrevented = false;
    d.preventDefault = () => {
      d.defaultPrevented = true;
    };
    const handlerName = ev.type === "paste" ? "paste" : "keydown";
    for (let n: Renderable | null = current; n; n = n.parent) {
      const handler = n.events.get(handlerName);
      if (handler) {
        handler(d);
        if (d.defaultPrevented) break;
      }
    }
  }

  return {
    focus,
    blur,
    focusNext: () => step(1),
    focusPrev: () => step(-1),
    current: () => current,
    release: (node) => {
      if (current === node) current = null;
    },
    dispatch,
  };
}
