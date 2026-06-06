import { describe, expect, test } from "bun:test";
import { h, nextTick, ref } from "@vue/runtime-core";
import { VuiVirtualList } from "../src/virtual-list.ts";
import { allGlyphs, cellBg, key, mount } from "./helpers.ts";

const ITEMS = Array.from({ length: 1000 }, (_, i) => `row${i}`);

describe("VuiVirtualList", () => {
  test("only the windowed rows are painted (not all 1000)", async () => {
    const { renderer, cleanup } = mount(30, 6, () =>
      h(VuiVirtualList, { items: ITEMS, height: 5, focused: true }, {
        default: ({ item }: { item: unknown }) => h("text", {}, item as string),
      }),
    );
    await nextTick();
    const screen = allGlyphs(renderer);
    expect(screen).toContain("row0");
    expect(screen).not.toContain("row999"); // far item is not mounted
    cleanup();
  });

  test("End scrolls to the bottom, mounting the last rows", async () => {
    const { renderer, dispatch, settle, cleanup } = mount(30, 6, () =>
      h(VuiVirtualList, { items: ITEMS, height: 5, focused: true }, {
        default: ({ item }: { item: unknown }) => h("text", {}, item as string),
      }),
    );
    await nextTick();
    dispatch(key("end"));
    await settle();
    const screen = allGlyphs(renderer);
    expect(screen).toContain("row999");
    expect(screen).not.toContain("row0"); // top is now scrolled away / unmounted
    cleanup();
  });

  test("100k items with a definite height stay bounded (no freeze / mass-mount)", async () => {
    const big = Array.from({ length: 100_000 }, (_, i) => `row${i}`);
    const { app, settle, cleanup } = mount(30, 12, () =>
      h(VuiVirtualList, { items: big, height: 10, focused: true }, {
        default: ({ item }: { item: unknown }) => h("text", {}, item as string),
      }),
    );
    await nextTick();
    await settle();
    // The huge bottom spacer is clipped by the definite height + overflow:scroll;
    // windowing keeps the mounted tree tiny even with 100k items.
    let nodes = 0;
    const visit = (n: any): void => { nodes++; for (const c of n.children) visit(c); };
    visit(app.context.root);
    expect(nodes).toBeLessThan(2000);
    cleanup();
  });

  test("with a scrollbar it still scrolls and the bar paints a thumb", async () => {
    const scrolls: number[] = [];
    const { renderer, dispatch, settle, cleanup } = mount(20, 8, () =>
      h(VuiVirtualList, { items: ITEMS, height: 6, scrollbar: true, focused: true, onScroll: (y: number) => scrolls.push(y) }, {
        default: ({ item }: { item: unknown }) => h("text", {}, item as string),
      }),
    );
    await nextTick();
    await settle();
    dispatch(key("pageDown"));
    expect(scrolls.at(-1)).toBeGreaterThan(0);
    // The bar occupies the right-most column; its thumb cell has a non-default bg.
    const x = renderer.width - 1;
    let thumbCells = 0;
    for (let y = 0; y < 6; y++) if (cellBg(renderer, x, y).r > 0 || cellBg(renderer, x, y).g > 0 || cellBg(renderer, x, y).b > 0) thumbCells++;
    expect(thumbCells).toBeGreaterThan(0);
    cleanup();
  });

  test("controlled scrollY: an ancestor can drive scroll; the list echoes back", async () => {
    const driver = ref(0);
    const echoes: number[] = [];
    const { renderer, settle, cleanup } = mount(20, 8, () =>
      h(VuiVirtualList, {
        items: ITEMS,
        height: 6,
        scrollY: driver.value,
        "onUpdate:scrollY": (y: number) => echoes.push(y),
      }, { default: ({ item }: { item: unknown }) => h("text", {}, item as string) }),
    );
    await nextTick();
    await settle();
    driver.value = 40; // ancestor scrolls the list
    await settle();
    expect(allGlyphs(renderer)).toContain("row40");
    expect(allGlyphs(renderer)).not.toContain("row0");
    cleanup();
  });

  test("letter keys bubble through a focused list to an ancestor (gallery pattern)", () => {
    const hits: string[] = [];
    const { ctx, cleanup } = mount(30, 8, () =>
      h("box", { onKeyDown: (ev: any) => { if (ev.type === "key" && ev.name === "c") hits.push("menu"); } },
        h(VuiVirtualList, { items: ITEMS, height: 6, focused: true }, {
          default: ({ item }: { item: unknown }) => h("text", {}, item as string),
        }),
      ),
    );
    ctx.focusManager!.dispatch(key("down")); // consumed by the list (scrolls)
    ctx.focusManager!.dispatch(key("c"));     // ignored by the list → bubbles up
    expect(hits).toEqual(["menu"]);
    cleanup();
  });

  test("Down scrolls by one step", async () => {
    const { renderer, dispatch, settle, cleanup } = mount(30, 6, () =>
      h(VuiVirtualList, { items: ITEMS, height: 5, focused: true }, {
        default: ({ item }: { item: unknown }) => h("text", {}, item as string),
      }),
    );
    await nextTick();
    for (let i = 0; i < 10; i++) dispatch(key("down"));
    await settle();
    const screen = allGlyphs(renderer);
    expect(screen).toContain("row10");
    cleanup();
  });
});
