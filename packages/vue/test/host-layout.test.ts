// Phase 03 (layout via FFI): the JS-host Renderables receive correct taffy rects
// — flex split, explicit dims, padding insets, and auto-size text — via the
// layout-only native node tree, with the measure driven by the shared wrap logic.
// Mounts offscreen with an injected fixed-size renderer so geometry is exact.
import { describe, expect, test } from "bun:test";
import { Renderer } from "@vui-rs/core";
import type { Renderable } from "../src/host/renderable.ts";
import { createHostApp } from "../src/host/create-host-app.ts";
import { defineComponent, h, nextTick, ref } from "../src/index.ts";

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return {
    app,
    root: app.context.root!,
    cleanup: () => {
      app.unmount();
      r.free();
    },
  };
}

const round = (n: number) => Math.round(n);

describe("JS-host layout (taffy via FFI)", () => {
  test("a flex row splits two grow:1 children evenly", () => {
    const { root, cleanup } = mount(40, 10, () =>
      h("box", { width: 40, height: 10, flexDirection: "row" }, [
        h("box", { flexGrow: 1, height: 10 }),
        h("box", { flexGrow: 1, height: 10 }),
      ]),
    );
    const container = root.children[0]!;
    const [a, b] = container.children;
    expect(round(a!.rect!.x)).toBe(0);
    expect(round(a!.rect!.w)).toBe(20);
    expect(round(b!.rect!.x)).toBe(20);
    expect(round(b!.rect!.w)).toBe(20);
    cleanup();
  });

  test("explicit dims + padding are reported as rect + insets", () => {
    const { root, cleanup } = mount(20, 6, () =>
      h("box", { width: 12, height: 4, padding: { left: 1, top: 2, right: 1, bottom: 1 } }),
    );
    const box = root.children[0]!;
    expect(round(box.rect!.w)).toBe(12);
    expect(round(box.rect!.h)).toBe(4);
    expect(round(box.rect!.padding.left)).toBe(1);
    expect(round(box.rect!.padding.top)).toBe(2);
    cleanup();
  });

  test("a bare <text> auto-sizes to its content (shared wrap measure)", () => {
    const { root, cleanup } = mount(80, 24, () =>
      // row + align-start so BOTH axes show the measured size (stretch would mask height).
      h("box", { width: 80, height: 24, flexDirection: "row", alignItems: "flex-start" }, [
        h("text", {}, "hello"),
      ]),
    );
    const text = root.children[0]!.children[0]!;
    expect(text.kind).toBe("text");
    expect(round(text.rect!.w)).toBe(5);
    expect(round(text.rect!.h)).toBe(1);
    cleanup();
  });

  test("wrapping text in a fixed width reports the wrapped height", () => {
    const { root, cleanup } = mount(80, 24, () =>
      h("box", { width: 80, height: 24, flexDirection: "row", alignItems: "flex-start" }, [
        h("text", { width: 10 }, "abcdefghijklmnopqrstuvwxy"), // 25 chars / 10 = 3 rows
      ]),
    );
    const text = root.children[0]!.children[0]!;
    expect(round(text.rect!.w)).toBe(10);
    expect(round(text.rect!.h)).toBe(3);
    cleanup();
  });

  test("removing a node frees its layout subtree and re-lays-out the rest (no stale handle)", async () => {
    const show = ref(true);
    const { app, root, cleanup } = mount(40, 6, () =>
      h("box", { width: 40, height: 6, flexDirection: "row", alignItems: "flex-start" }, [
        show.value ? h("text", { key: "a" }, "hello") : null,
        h("text", { key: "b" }, "x"),
      ]),
    );
    const container = root.children[0]!;
    const textsOf = () => container.children.filter((c) => c.kind === "text");
    // Both present: "hello" (5 wide) then "x" at x=5.
    expect(textsOf()).toHaveLength(2);
    expect(round(textsOf()[1]!.rect!.x)).toBe(5);

    // Remove the first text → its layout node is freed; the survivor re-lays-out to x=0.
    // flushNow bypasses the frame throttle so the layout pass runs deterministically.
    show.value = false;
    await nextTick();
    app.context.flushNow();
    expect(textsOf()).toHaveLength(1);
    expect(round(textsOf()[0]!.rect!.x)).toBe(0); // no throw, no stale handle, re-laid-out

    // Re-add → back to two, first at x=0, second after it.
    show.value = true;
    await nextTick();
    app.context.flushNow();
    expect(textsOf()).toHaveLength(2);
    expect(round(textsOf()[1]!.rect!.x)).toBe(5);
    cleanup();
  });

  test("layout is dirty-gated: an idle re-render clears no work and keeps rects", async () => {
    const { app, root, cleanup } = mount(40, 10, () =>
      h("box", { width: 40, height: 10 }, [h("text", {}, "hi")]),
    );
    const ctx = app.context;
    // After mount, the first layout ran and the dirty sets are drained.
    expect(ctx.dirtyLayout.size).toBe(0);
    expect(ctx.dirtyText.size).toBe(0);
    const box = root.children[0]!;
    const before = { ...box.rect! };
    // A bare flush with nothing dirty must not change geometry.
    ctx.flushNow();
    await nextTick();
    expect(box.rect!.w).toBe(before.w);
    expect(box.rect!.h).toBe(before.h);
    cleanup();
  });
});
