// Vue ⟷ Rust binding tests. They run offscreen (a renderer is injected, no alt
// screen) and assert the core guarantees: the JS mirror and Rust trees stay in
// lockstep, a reactive batch coalesces to one render, text updates in place,
// unmounting frees every Rust node, and a late schedule after teardown never
// touches the freed renderer. Low-level renderer-option tests cover the
// text-only nesting rule and rich-run flattening.
import { describe, expect, test } from "bun:test";
import { Attr, hostTreeHash, Renderer } from "@vui-rs/core";
import { createApp, defineComponent, h, nextTick, ref } from "../src/index.ts";
import { type VuiContext } from "../src/host-node.ts";
import { darkTheme } from "../src/theme.ts";
import { flattenRuns } from "../src/runs.ts";
import { createRendererOptions } from "../src/renderer-options.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeCtx(renderer: Renderer): VuiContext {
  return {
    renderer,
    root: null,
    dirtyStyle: new Set(),
    dirtyText: new Set(),
    pendingFree: [],
    liveNative: new Set(),
    theme: darkTheme,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    focusManager: null,
  };
}

describe("vue custom renderer", () => {
  test("mounts a tree whose JS mirror matches the Rust tree", () => {
    const r = new Renderer(24, 6);
    const App = defineComponent({
      setup: () => () => h("box", { width: 20 }, [h("text", null, "hi")]),
    });
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    try {
      // box + text are Rust-backed; the root is implicit and not counted.
      expect(app.context.liveNative.size).toBe(2);
      expect(hostTreeHash(app.context.root!.core!)).toBe(r.treeHash());
    } finally {
      app.unmount();
      r.free();
    }
  });

  test("a batch of reactive writes in one tick triggers exactly one render", async () => {
    const r = new Renderer(24, 6);
    const count = ref(0);
    const App = defineComponent({
      setup: () => () => h("text", null, String(count.value)),
    });
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    try {
      await sleep(20);
      app.context.renderCount = 0;
      count.value = 1;
      count.value = 2;
      count.value = 3;
      await nextTick();
      await sleep(20);
      expect(app.context.renderCount).toBe(1);
    } finally {
      app.unmount();
      r.free();
    }
  });

  test("text content updates in place without recreating the node", async () => {
    const r = new Renderer(24, 6);
    const msg = ref("a");
    const App = defineComponent({
      setup: () => () => h("text", null, msg.value),
    });
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    try {
      const textNode = app.context.root!.children[0]!;
      const idBefore = textNode.core!.id;
      const liveBefore = app.context.liveNative.size;

      msg.value = "bb";
      await nextTick();
      await sleep(20);

      expect(textNode.core!.id).toBe(idBefore); // same Rust node, not recreated
      expect(app.context.liveNative.size).toBe(liveBefore);
    } finally {
      app.unmount();
      r.free();
    }
  });

  test("unmount frees every Rust node (no leak)", () => {
    const r = new Renderer(24, 6);
    const empty = new Renderer(24, 6);
    const emptyHash = empty.treeHash();
    empty.free();

    const App = defineComponent({
      setup: () => () => h("box", { border: "single" }, [h("text", null, "x"), h("box")]),
    });
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    expect(app.context.liveNative.size).toBeGreaterThan(0);

    app.unmount();
    try {
      expect(app.context.liveNative.size).toBe(0);
      expect(r.treeHash()).toBe(emptyHash); // root has no children left
    } finally {
      r.free();
    }
  });

  test("a late render after unmount never touches the freed renderer", async () => {
    // Owns its renderer (none injected), so unmount frees it. A flush/schedule
    // queued after teardown must be inert — not a render against freed memory.
    const App = defineComponent({
      setup: () => () => h("box", null, [h("text", null, "hi")]),
    });
    const app = createApp(App).mount({ width: 24, height: 6, altScreen: false });

    app.unmount();
    expect(app.context.renderer).toBeNull();
    expect(() => app.context.flushNow()).not.toThrow();
    app.context.scheduleRender();
    await nextTick();
    await sleep(20);
    expect(app.context.renderer).toBeNull();
  });
});

describe("renderer-option rules", () => {
  test("a bare string outside <text> is rejected", () => {
    const r = new Renderer(20, 6);
    try {
      const ops = createRendererOptions(makeCtx(r));
      const box = ops.createElement("box");
      const str = ops.createText("hello");
      expect(() => ops.insert(str, box, null)).toThrow(/wrapped in <text>/);
    } finally {
      r.free();
    }
  });

  test("an EMPTY text node is allowed in a box (Vue fragment/v-for anchor)", () => {
    const r = new Renderer(20, 6);
    try {
      const ops = createRendererOptions(makeCtx(r));
      const box = ops.createElement("box");
      const anchor = ops.createText("");
      expect(() => ops.insert(anchor, box, null)).not.toThrow();
      // It lives in the mirror tree as an inert anchor, removable without error.
      expect(box.children).toContain(anchor);
      expect(() => ops.remove(anchor)).not.toThrow();
    } finally {
      r.free();
    }
  });

  test("an anchor that later gets real content fails loud (no silent drop)", () => {
    const r = new Renderer(20, 6);
    try {
      const ops = createRendererOptions(makeCtx(r));
      const box = ops.createElement("box");
      const anchor = ops.createText(""); // allowed in as an empty anchor
      ops.insert(anchor, box, null);
      // Populating it has no <text> to render into — must throw, not vanish.
      expect(() => ops.setText(anchor, "boom")).toThrow(/wrapped in <text>/);
    } finally {
      r.free();
    }
  });

  test("<text> flattens plain + styled spans into ordered runs", () => {
    const r = new Renderer(20, 6);
    try {
      const ctx = makeCtx(r);
      const ops = createRendererOptions(ctx);
      const text = ops.createElement("text");
      const plain = ops.createText("plain ");
      const bold = ops.createElement("b");
      const boldText = ops.createText("bold");

      ops.insert(plain, text, null);
      ops.insert(bold, text, null);
      ops.insert(boldText, bold, null);

      const runs = flattenRuns(text);
      expect(runs.map((run) => run.text)).toEqual(["plain ", "bold"]);
      expect(runs[1]!.attrs).toBe(Attr.BOLD);
      // Only <text> is Rust-backed; <b> is a virtual run-style contributor.
      expect(ctx.liveNative.size).toBe(1);
    } finally {
      r.free();
    }
  });
});
