// Phase 01a compositing: z-index stacking + the overlay/portal layer + opaque
// dim backdrop. Asserts (1) parity — a tree with no z-index/overlay paints in
// document order, the overlay registry stays empty; (2) z-index reorders sibling
// paint order; (3) the positive golden frame — a centered modal over a dimmed
// backdrop; (4) the modal captures hit-testing; (5) closing the overlay frees it.
import { describe, expect, test } from "bun:test";
import { Attr, Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { hitTestTopmost } from "../src/host/hit-test.ts";
import { defineComponent, h, nextTick, ref } from "../src/index.ts";
import { cellAttrs, cellBg, cellGlyph } from "./helpers/read-buffer.ts";

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return {
    app,
    renderer: r,
    ctx: app.context,
    cleanup: () => {
      app.unmount();
      r.free();
    },
  };
}

describe("z-index stacking", () => {
  test("default z=0 keeps document order and registers no overlays (parity)", async () => {
    const { renderer, ctx, app, cleanup } = mount(6, 1, () =>
      h("box", { width: 6, height: 1 }, [
        // Two absolutely-stacked cells at the same spot; later sibling wins.
        h("box", { position: "absolute", left: 0, top: 0, width: 1, height: 1, bg: 0xaa0000ff }),
        h("box", { position: "absolute", left: 0, top: 0, width: 1, height: 1, bg: 0x00bb00ff }),
      ]),
    );
    await nextTick();
    app.context.flushNow();

    expect(ctx.overlays.length).toBe(0);
    // No z-index → the second box (document order) paints on top.
    expect(cellBg(renderer, 0, 0)).toEqual({ r: 0x00, g: 0xbb, b: 0x00, a: 0xff });
    cleanup();
  });

  test("higher z-index paints on top regardless of document order", async () => {
    const { renderer, app, cleanup } = mount(6, 1, () =>
      h("box", { width: 6, height: 1 }, [
        h("box", { position: "absolute", left: 0, top: 0, width: 1, height: 1, bg: 0xaa0000ff, zIndex: 5 }),
        h("box", { position: "absolute", left: 0, top: 0, width: 1, height: 1, bg: 0x00bb00ff }),
      ]),
    );
    await nextTick();
    app.context.flushNow();

    // First box has the higher z, so it wins despite being earlier.
    expect(cellBg(renderer, 0, 0)).toEqual({ r: 0xaa, g: 0x00, b: 0x00, a: 0xff });
    cleanup();
  });
});

describe("overlay layer + backdrop", () => {
  // The positive golden frame: a 4×3 modal centered over an opaque-dimmed
  // backdrop on a 10×5 screen filled by background content.
  function modalApp(open = true) {
    return () => [
      h("box", { width: 10, height: 5, bg: 0x202020ff }),
      open
        ? h(
            "overlay",
            { backdrop: 0.5, alignItems: "center", justifyContent: "center" },
            [h("box", { width: 4, height: 3, bg: 0x0000ffff, border: true }, [h("text", {}, "M")])],
          )
        : null,
    ];
  }

  test("modal centers over a dimmed backdrop (golden frame)", async () => {
    const { renderer, ctx, app, cleanup } = mount(10, 5, modalApp());
    await nextTick();
    app.context.flushNow();

    expect(ctx.overlays.length).toBe(1);
    // Backdrop: a cell outside the modal box is the content bg (0x20) halved.
    expect(cellBg(renderer, 0, 0)).toEqual({ r: 0x10, g: 0x10, b: 0x10, a: 0xff });
    // Modal box is 4×3 centered → x∈[3,7), y∈[1,4); its interior bg is opaque blue.
    expect(cellBg(renderer, 4, 2)).toEqual({ r: 0x00, g: 0x00, b: 0xff, a: 0xff });
    // Border glyph at the modal's top-left corner.
    expect(cellGlyph(renderer, 3, 1)).toBe("┌");
    cleanup();
  });

  test("backdrop modal captures hit-testing over the layer behind", async () => {
    const { renderer, ctx, app, cleanup } = mount(10, 5, modalApp());
    await nextTick();
    app.context.flushNow();

    // A click on the dimmed backdrop (outside the modal box) does NOT fall
    // through to the content box behind — the modal overlay captures it.
    const overlay = ctx.overlays[0]!;
    const onBackdrop = hitTestTopmost(ctx, 0, 0);
    expect(onBackdrop).toBe(overlay);
    // A click inside the modal lands on the modal's content, not the layer below.
    const inModal = hitTestTopmost(ctx, 4, 2);
    expect(inModal).not.toBeNull();
    expect(overlay === inModal || overlay.children.includes(inModal!) || isDescendant(overlay, inModal!)).toBe(true);
    void renderer;
    cleanup();
  });

  test("closing the overlay unregisters it and clears its paint", async () => {
    const open = ref(true);
    const { renderer, ctx, app, cleanup } = mount(10, 5, () => modalApp(open.value)());
    await nextTick();
    app.context.flushNow();
    expect(ctx.overlays.length).toBe(1);

    open.value = false;
    await nextTick();
    app.context.flushNow();

    expect(ctx.overlays.length).toBe(0);
    // Backdrop gone: the corner is the undimmed content bg again.
    expect(cellBg(renderer, 0, 0)).toEqual({ r: 0x20, g: 0x20, b: 0x20, a: 0xff });
    // Modal interior is back to the content bg.
    expect(cellBg(renderer, 4, 2)).toEqual({ r: 0x20, g: 0x20, b: 0x20, a: 0xff });
    cleanup();
  });
});

describe("overlay edge cases", () => {
  test("backdrop dims wide glyphs without destroying the pair", async () => {
    const { renderer, app, cleanup } = mount(6, 1, () => [
      h("box", { width: 6, height: 1, bg: 0x202020ff }, [h("text", {}, "世界")]),
      h("overlay", { backdrop: 0.5 }),
    ]);
    await nextTick();
    app.context.flushNow();

    // The wide glyphs survive (not blanked by setCell's defuse) and are dimmed.
    expect(cellGlyph(renderer, 0, 0)).toBe("世");
    expect(cellGlyph(renderer, 2, 0)).toBe("界");
    expect(cellAttrs(renderer, 1, 0) & Attr.WIDE_CONTINUATION).toBeTruthy();
    expect(cellBg(renderer, 0, 0)).toEqual({ r: 0x10, g: 0x10, b: 0x10, a: 0xff });
    cleanup();
  });

  test("overlay accepts per-side inset overrides without crashing", async () => {
    const { renderer, ctx, app, cleanup } = mount(10, 5, () => [
      h("overlay", { top: 1, left: 2 }, [
        h("box", { width: 2, height: 1, bg: 0xcc0000ff }),
      ]),
    ]);
    await nextTick();
    app.context.flushNow();

    expect(ctx.overlays.length).toBe(1);
    // The overlay (and its content) is offset by the per-side inset: top:1 left:2.
    expect(cellBg(renderer, 2, 1)).toEqual({ r: 0xcc, g: 0x00, b: 0x00, a: 0xff });
    cleanup();
  });

  test("nested overlay-in-overlay registers both and frees both on close", async () => {
    const open = ref(true);
    const { ctx, app, cleanup } = mount(10, 5, () =>
      open.value
        ? h("overlay", { backdrop: 0.5 }, [
            h("box", { width: 4, height: 2, bg: 0x0000ffff }),
            h("overlay", {}, [h("box", { width: 2, height: 1, bg: 0x00ff00ff })]),
          ])
        : null,
    );
    await nextTick();
    app.context.flushNow();
    expect(ctx.overlays.length).toBe(2);

    // Removing the outer overlay must also free the hoisted inner one (its layout
    // node lives under the root, outside the outer's free() cascade).
    open.value = false;
    await nextTick();
    app.context.flushNow();
    expect(ctx.overlays.length).toBe(0);
    cleanup();
  });
});

function isDescendant(root: import("../src/host/renderable.ts").Renderable, node: import("../src/host/renderable.ts").Renderable): boolean {
  for (let n: typeof node | null = node; n; n = n.parent) if (n === root) return true;
  return false;
}
