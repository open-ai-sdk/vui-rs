import { describe, expect, test } from "bun:test";
import type { MouseEvent } from "@vui-rs/core";
import { createHostFocusManager } from "../src/host/focus.ts";
import { type HostContext, Renderable } from "../src/host/renderable.ts";
import { createHostScheduler } from "../src/host/scheduler.ts";

function mouse(partial: Partial<MouseEvent> = {}): MouseEvent {
  return {
    type: "mouse",
    kind: "down",
    button: "left",
    x: 1,
    y: 1,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: "",
    ...partial,
  };
}

function context(): HostContext {
  const ctx = {
    renderer: null,
    root: null,
    theme: {} as HostContext["theme"],
    dirtyLayout: new Set<Renderable>(),
    dirtyText: new Set<Renderable>(),
    layoutW: -1,
    layoutH: -1,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    layout: null,
    paint: null,
    focusManager: null,
  } satisfies HostContext;
  ctx.focusManager = createHostFocusManager(ctx);
  return ctx;
}

function node(ctx: HostContext, tag: string, rect: { x0: number; y0: number; x1: number; y1: number }): Renderable {
  const n = new Renderable(ctx, "box", tag);
  n.screenRect = rect;
  return n;
}

function append(parent: Renderable, child: Renderable): Renderable {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

describe("mouse input dispatch", () => {
  test("click focuses the hit focusable node and fires onMouseDown with coords", () => {
    const ctx = context();
    const root = node(ctx, "root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const child = append(root, node(ctx, "child", { x0: 1, y0: 1, x1: 6, y1: 4 }));
    child.focusable = true;
    ctx.root = root;

    const seen: MouseEvent[] = [];
    child.events.set("mousedown", (ev) => seen.push(ev as MouseEvent));
    ctx.focusManager!.dispatch(mouse({ x: 2, y: 2 }));

    expect(ctx.focusManager!.current()).toBe(child);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "down", x: 2, y: 2, button: "left" });
  });

  test("mouse events bubble to ancestors and respect preventDefault", () => {
    const ctx = context();
    const root = node(ctx, "root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const child = append(root, node(ctx, "child", { x0: 1, y0: 1, x1: 6, y1: 4 }));
    ctx.root = root;
    const hits: string[] = [];
    root.events.set("mousemove", () => hits.push("root"));
    child.events.set("mousemove", (ev) => {
      hits.push("child");
      (ev as { preventDefault: () => void }).preventDefault();
    });

    ctx.focusManager!.dispatch(mouse({ kind: "move", button: null, x: 2, y: 2 }));
    expect(hits).toEqual(["child"]);
  });

  test("wheel dispatches to the node under the cursor", () => {
    const ctx = context();
    const root = node(ctx, "root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const child = append(root, node(ctx, "child", { x0: 1, y0: 1, x1: 6, y1: 4 }));
    ctx.root = root;
    const hits: MouseEvent[] = [];
    child.events.set("wheel", (ev) => hits.push(ev as MouseEvent));

    ctx.focusManager!.dispatch(mouse({ kind: "wheel", button: "wheelUp", x: 3, y: 2 }));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "wheel", button: "wheelUp" });
  });

  test("move-triggered renders are coalesced by the host scheduler", async () => {
    const ctx = context();
    const scheduler = createHostScheduler(ctx);
    ctx.scheduleRender = scheduler.scheduleRender;
    ctx.flushNow = scheduler.flushNow;
    ctx.dispose = scheduler.dispose;
    const root = node(ctx, "root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const child = append(root, node(ctx, "child", { x0: 1, y0: 1, x1: 6, y1: 4 }));
    ctx.root = root;
    child.events.set("mousemove", () => ctx.scheduleRender());

    for (let i = 0; i < 10; i += 1) {
      ctx.focusManager!.dispatch(mouse({ kind: "move", button: null, x: 2, y: 2 }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.renderCount).toBeLessThanOrEqual(1);
    scheduler.dispose();
  });
});
