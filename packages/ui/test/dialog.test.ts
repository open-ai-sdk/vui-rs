import { describe, expect, test } from "bun:test";
import { h, nextTick, ref } from "@vue/runtime-core";
import type { Renderable } from "@vui-rs/vue";
import { VuiDialog } from "../src/dialog.ts";
import { allGlyphs, key, mouseDown, mount } from "./helpers.ts";

describe("VuiDialog", () => {
  test("renders the panel + title only while open", async () => {
    const open = ref(false);
    const { renderer, flush, cleanup } = mount(60, 16, () =>
      h(VuiDialog, { open: open.value, title: "Hello" }, () => h("text", {}, "BodyContent")),
    );
    await nextTick();
    flush();
    expect(allGlyphs(renderer)).not.toContain("BodyContent");

    open.value = true;
    await nextTick();
    flush();
    const screen = allGlyphs(renderer);
    expect(screen).toContain("BodyContent");
    expect(screen).toContain("Hello");
    cleanup();
  });

  test("Esc emits close + update:open=false", async () => {
    const open = ref(true);
    const closed: boolean[] = [];
    const { dispatch, flush, cleanup } = mount(60, 16, () =>
      h(VuiDialog, {
        open: open.value,
        title: "X",
        "onUpdate:open": (v: boolean) => (open.value = v),
        onClose: () => closed.push(true),
      }, () => h("text", {}, "hi")),
    );
    await nextTick();
    flush();
    dispatch(key("escape"));
    expect(open.value).toBe(false);
    expect(closed).toEqual([true]);
    cleanup();
  });

  test("focus-trap confines Tab to the dialog subtree", async () => {
    const { ctx, app, flush, cleanup } = mount(60, 16, () =>
      h("box", {}, [
        h("box", { focusable: true, key: "bg1" }),
        h("box", { focusable: true, key: "bg2" }),
        h(VuiDialog, { open: true, title: "T", autofocus: false }, () => [
          h("box", { focusable: true, key: "d1" }),
          h("box", { focusable: true, key: "d2" }),
        ]),
      ]),
    );
    await nextTick();
    flush();
    const fm = ctx.focusManager!;
    // Walk several Tab steps; every focused node must live under an overlay
    // (the trapped modal), never the background boxes.
    const insideOverlay = (): boolean => {
      let n = fm.current();
      while (n) {
        if (n.isOverlay) return true;
        n = n.parent;
      }
      return false;
    };
    fm.focusNext();
    expect(insideOverlay()).toBe(true);
    fm.focusNext();
    expect(insideOverlay()).toBe(true);
    fm.focusNext();
    expect(insideOverlay()).toBe(true);
    cleanup();
  });

  test("closing restores focus to the node focused before opening", async () => {
    const open = ref(false);
    let bg!: Renderable;
    const { ctx, flush, dispatch, cleanup } = mount(60, 16, () =>
      h("box", {}, [
        h("box", { focusable: true, ref: (el: unknown) => (bg = el as Renderable) }),
        h(VuiDialog, {
          open: open.value,
          title: "T",
          "onUpdate:open": (v: boolean) => (open.value = v),
        }, () => h("text", {}, "hi")),
      ]),
    );
    await nextTick();
    ctx.focusManager!.focus(bg);
    expect(ctx.focusManager!.current()).toBe(bg);
    open.value = true;
    await nextTick();
    flush();
    expect(ctx.focusManager!.current()).not.toBe(bg); // focus moved into the modal
    dispatch(key("escape"));
    await nextTick();
    flush();
    expect(ctx.focusManager!.current()).toBe(bg); // restored
    cleanup();
  });

  test("a click outside a backdrop-less trapping modal does not focus the background", async () => {
    let bg!: Renderable;
    const { ctx, flush, dispatch, cleanup } = mount(60, 16, () =>
      h("box", {}, [
        h("box", { focusable: true, width: 60, height: 2, ref: (el: unknown) => (bg = el as Renderable) }),
        h(VuiDialog, { open: true, title: "T", backdrop: false, autofocus: true }, () => h("text", {}, "hi")),
      ]),
    );
    await nextTick();
    flush();
    const before = ctx.focusManager!.current();
    dispatch(mouseDown(0, 0)); // top-left: over the background box, outside the centered modal
    expect(ctx.focusManager!.current()).not.toBe(bg); // trap kept focus off the background
    expect(ctx.focusManager!.current()).toBe(before);
    cleanup();
  });
});
