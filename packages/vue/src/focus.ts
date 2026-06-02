// Per-app focus model. It keeps no list of its own — focus order is the DFS of
// the host tree filtered to nodes flagged `focusable`, recomputed on each move so
// it always reflects the current tree (no stale registry to keep in sync). One
// node holds focus at a time; Tab/Shift-Tab cycle it. A key/paste event is
// dispatched to the focused node's handler first, then bubbles to its ancestors,
// stopping when a handler calls `preventDefault()`.
import type { InputEvent } from "@vui-rs/core";
import type { VuiContext, VuiHostNode } from "./host-node.ts";

/** An input event as seen by handlers — augmented with bubble control. */
export type DispatchableEvent = InputEvent & {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

export interface FocusManager {
  focus(node: VuiHostNode): void;
  blur(): void;
  focusNext(): void;
  focusPrev(): void;
  current(): VuiHostNode | null;
  /** Drop a node from focus if it currently holds it (called when it unmounts). */
  release(node: VuiHostNode): void;
  /** Route a key/paste event to the focused node, then bubble to ancestors. */
  dispatch(ev: InputEvent): void;
}

export function createFocusManager(ctx: VuiContext): FocusManager {
  let current: VuiHostNode | null = null;

  /** Focusable nodes in DFS (tab) order, walked from the app root. */
  function order(): VuiHostNode[] {
    const out: VuiHostNode[] = [];
    const visit = (node: VuiHostNode | null): void => {
      if (!node) return;
      if (node.focusable) out.push(node);
      for (const child of node.children) visit(child);
    };
    visit(ctx.root);
    return out;
  }

  function setFocused(node: VuiHostNode, on: boolean): void {
    if (node.kind === "edit") node.core?.edit.setFocused(on);
    node.events.get(on ? "focus" : "blur")?.();
  }

  function focus(node: VuiHostNode): void {
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
    for (let n: VuiHostNode | null = current; n; n = n.parent) {
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
