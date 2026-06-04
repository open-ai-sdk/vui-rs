import { describe, expect, test } from "bun:test";
import { Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { VuiScrollBar } from "../src/host/components/scroll-bar.ts";
import { VuiScrollBox } from "../src/host/components/scroll-box.ts";
import { defineComponent, h, nextTick, ref } from "../src/index.ts";
import { allGlyphs, cellGlyph } from "./helpers/read-buffer.ts";

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return {
    app,
    renderer: r,
    root: app.context.root!,
    cleanup: () => {
      app.unmount();
      r.free();
    },
  };
}

describe("scroll-box", () => {
  test("scrollY shifts children inside the existing content clip", async () => {
    const y = ref(1);
    const { app, renderer, cleanup } = mount(10, 4, () =>
      h(VuiScrollBox, { width: 4, height: 2, modelValue: y.value }, () => [
        h("text", {}, "A"),
        h("text", {}, "B"),
        h("text", {}, "C"),
      ]),
    );
    await nextTick();
    app.context.flushNow();

    expect(cellGlyph(renderer, 0, 0)).toBe("B");
    expect(cellGlyph(renderer, 0, 1)).toBe("C");
    expect(allGlyphs(renderer)).not.toContain("A");
    cleanup();
  });

  test("wheel and keyboard scrolling clamp at content bounds", async () => {
    let seen = 0;
    const { app, renderer, cleanup } = mount(10, 5, () =>
      h(
        VuiScrollBox,
        {
          width: 4,
          height: 2,
          focused: true,
          onScroll: (value: number) => {
            seen = value;
          },
        },
        () => [h("text", {}, "A"), h("text", {}, "B"), h("text", {}, "C")],
      ),
    );
    await nextTick();
    app.context.flushNow();

    app.context.focusManager!.dispatch({
      type: "key",
      name: "pageDown",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: "",
    });
    app.context.flushNow();
    expect(seen).toBe(1);
    expect(cellGlyph(renderer, 0, 0)).toBe("B");

    app.context.focusManager!.dispatch({
      type: "mouse",
      kind: "wheel",
      button: "wheelUp",
      x: 0,
      y: 0,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: "",
    });
    app.context.flushNow();
    expect(seen).toBe(0);
    expect(cellGlyph(renderer, 0, 0)).toBe("A");
    cleanup();
  });

  test("nested scrollboxes compose clips and offsets", async () => {
    const { app, renderer, cleanup } = mount(10, 4, () =>
      h(VuiScrollBox, { width: 4, height: 2, modelValue: 1 }, () => [
        h("text", {}, "X"),
        h(VuiScrollBox, { width: 4, height: 2, modelValue: 1 }, () => [
          h("text", {}, "A"),
          h("text", {}, "B"),
          h("text", {}, "C"),
        ]),
      ]),
    );
    await nextTick();
    app.context.flushNow();

    expect(allGlyphs(renderer)).toBe("BC");
    cleanup();
  });
});

describe("scroll-bar", () => {
  test("thumb size and top track the scroll ratio", async () => {
    const scrollY = ref(5);
    const { app, root, cleanup } = mount(4, 12, () =>
      h(VuiScrollBar, {
        scrollY: scrollY.value,
        viewportHeight: 4,
        contentHeight: 8,
      }),
    );
    await nextTick();
    app.context.flushNow();

    const track = root.children[0]!;
    const thumb = track.children[0]!;
    expect(Math.round(thumb.rect!.h)).toBe(2);
    expect(Math.round(thumb.rect!.y)).toBe(2);
    cleanup();
  });
});

