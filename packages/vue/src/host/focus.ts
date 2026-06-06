// Per-app focus model for the JS host — the twin of the FFI host's focus.ts, but
// over `Renderable`s. Focus order is the DFS of the tree filtered to `focusable`
// nodes, recomputed per move (no stale registry). One node is focused at a time;
// Tab/Shift-Tab cycle it; a key/paste event dispatches to the focused node then
// bubbles to ancestors, stopping on `preventDefault()`.
import type { InputEvent, MouseEvent } from "@vui-rs/core";
import { type EditRenderable } from "./edit-renderable.ts";
import { hitTestTopmost } from "./hit-test.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { type TextareaRenderable } from "./textarea-renderable.ts";

/** An input event as seen by handlers — augmented with bubble control. */
export type DispatchableEvent = InputEvent & {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

export type DispatchableMouseEvent = MouseEvent & {
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
  /** Route an input event to its target, then bubble to ancestors. */
  dispatch(ev: InputEvent): void;
  /**
   * Capture the pointer to `node`: until released, all mouse move/drag/up events
   * route to it regardless of what's under the cursor — so a drag that leaves the
   * node (e.g. dragging a 1-cell scrollbar thumb sideways) keeps tracking.
   */
  setPointerCapture(node: Renderable): void;
  releasePointerCapture(node?: Renderable): void;
}

export function createHostFocusManager(ctx: HostContext): HostFocusManager {
  let current: Renderable | null = null;
  let captured: Renderable | null = null;

  /**
   * The topmost focus-trapping overlay (a modal), or null if none is open. Picks
   * the highest `zIndex`, ties broken by registration order (last wins) — the same
   * "on top" rule the overlay paint pass uses.
   */
  function trapRoot(): Renderable | null {
    let trap: Renderable | null = null;
    for (const ov of ctx.overlays) {
      if (ov.trapFocus && (!trap || ov.paint.zIndex >= trap.paint.zIndex)) trap = ov;
    }
    return trap;
  }

  /**
   * Focusable nodes in DFS (tab) order. While a focus-trapping overlay (modal) is
   * open, the order is confined to that overlay's subtree — Tab/Shift-Tab cycle
   * only within the modal — otherwise it walks the whole app root.
   */
  function order(): Renderable[] {
    const out: Renderable[] = [];
    const visit = (node: Renderable | null): void => {
      if (!node) return;
      if (node.focusable) out.push(node);
      for (const child of node.children) visit(child);
    };
    visit(trapRoot() ?? ctx.root);
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

  /** Is `node` inside `root`'s subtree (or is `root`)? */
  function within(node: Renderable | null, root: Renderable): boolean {
    for (let n = node; n; n = n.parent) {
      if (n === root) return true;
    }
    return false;
  }

  function findFocusable(node: Renderable | null): Renderable | null {
    const trap = trapRoot();
    for (let n = node; n; n = n.parent) {
      if (n.focusable) {
        // While a modal traps focus, a click outside it must not focus a node
        // behind it — even with no backdrop intercepting the click. Confine the
        // focus target to the trapped subtree (mirrors `order()`'s Tab scoping).
        if (trap && !within(n, trap)) return null;
        return n;
      }
    }
    return null;
  }

  function bubble(start: Renderable, ev: InputEvent, handlerName: string): void {
    const d = ev as DispatchableEvent;
    d.defaultPrevented = false;
    d.preventDefault = () => {
      d.defaultPrevented = true;
    };
    for (let n: Renderable | null = start; n; n = n.parent) {
      const handler = n.events.get(handlerName);
      if (handler) {
        handler(d);
        if (d.defaultPrevented) break;
      }
    }
  }

  function dispatchMouse(ev: MouseEvent): void {
    // An active pointer capture wins for move/drag/up: route straight to the
    // capturing node so a drag keeps tracking even off the node's cells. `down`
    // and `wheel` fall through to normal hit-testing.
    if (captured && ev.kind !== "down" && ev.kind !== "wheel") {
      bubble(captured, ev, ev.kind === "up" ? "mouseup" : "mousemove");
      if (ev.kind === "up") captured = null;
      return;
    }
    const underCursor = hitTestTopmost(ctx, ev.x, ev.y);
    const target = underCursor ?? current;
    if (!target) return;
    if (ev.kind === "down") {
      const focusTarget = findFocusable(target);
      if (focusTarget) focus(focusTarget);
    }
    const handlerName =
      ev.kind === "down"
        ? "mousedown"
        : ev.kind === "up"
          ? "mouseup"
          : ev.kind === "wheel"
            ? "wheel"
            : "mousemove";
    bubble(target, ev, handlerName);
  }

  function dispatch(ev: InputEvent): void {
    if (ev.type === "mouse") {
      dispatchMouse(ev);
      return;
    }
    if (!current) return;
    bubble(current, ev, ev.type === "paste" ? "paste" : "keydown");
  }

  return {
    focus,
    blur,
    focusNext: () => step(1),
    focusPrev: () => step(-1),
    current: () => current,
    release: (node) => {
      if (current === node) current = null;
      if (captured === node) captured = null;
    },
    dispatch,
    setPointerCapture: (node) => {
      captured = node;
    },
    releasePointerCapture: (node) => {
      if (!node || captured === node) captured = null;
    },
  };
}
