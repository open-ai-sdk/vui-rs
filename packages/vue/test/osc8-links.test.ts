// OSC 8 hyperlink plumbing: the stable link registry, run-flattening that bakes a
// link id into a run's `attrs` high byte, and the end-to-end path where a markdown
// link's cells carry that id on screen (the Rust emitter wraps them — covered by
// the renderer's own Rust test).
import { describe, expect, test } from "bun:test";
import { LINK_SHIFT, Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { LinkRegistry } from "../src/host/link-registry.ts";
import { flattenRuns } from "../src/host/runs.ts";
import { VuiMarkdown } from "../src/host/components/markdown.ts";
import { defineComponent, h } from "../src/index.ts";
import { cellAttrs, cellGlyph } from "./helpers/read-buffer.ts";

describe("link registry", () => {
  test("assigns stable, deduped ids starting at 1", () => {
    const reg = new LinkRegistry();
    expect(reg.idFor("https://a.io")).toBe(1);
    expect(reg.idFor("https://b.io")).toBe(2);
    expect(reg.idFor("https://a.io")).toBe(1); // same URI → same id (stable)
    expect(reg.size).toBe(2);
    expect(reg.entries()).toEqual([
      [1, "https://a.io"],
      [2, "https://b.io"],
    ]);
  });

  test("falls back to id 0 (unlinked) once the one-byte space is exhausted", () => {
    const reg = new LinkRegistry();
    for (let i = 0; i < 255; i++) expect(reg.idFor(`u${i}`)).toBe(i + 1);
    expect(reg.idFor("overflow")).toBe(0); // 256th distinct URI → no link
  });
});

describe("run flattening with links", () => {
  test("a span's link target becomes a link id in the run's attrs high byte", () => {
    const reg = new LinkRegistry();
    // Minimal Renderable stand-in: a <text> with one linked span child.
    const span = {
      kind: "span" as const,
      children: [],
      directText: "click",
      spanStyle: { attrs: 0, link: "https://x.io" },
    };
    const textNode = { kind: "text" as const, children: [span], directText: undefined };
    const runs = flattenRuns(textNode as never, reg);
    expect(runs).toHaveLength(1);
    expect(reg.idFor("https://x.io")).toBe(1);
    expect((runs[0]!.attrs ?? 0) >>> LINK_SHIFT).toBe(1);
  });

  test("no registry → no link bits (measure-only path stays pure)", () => {
    const span = {
      kind: "span" as const,
      children: [],
      directText: "click",
      spanStyle: { attrs: 0, link: "https://x.io" },
    };
    const textNode = { kind: "text" as const, children: [span], directText: undefined };
    const runs = flattenRuns(textNode as never);
    expect((runs[0]!.attrs ?? 0) >>> LINK_SHIFT).toBe(0);
  });
});

describe("markdown link end-to-end", () => {
  test("a markdown link's cells carry a link id and the table is staged", () => {
    const r = new Renderer(20, 3);
    const App = defineComponent({
      setup: () => () => h(VuiMarkdown, { content: "[go](https://x.io)" }),
    });
    const app = createHostApp(App).mount({ renderer: r });
    // The link text "go" is on screen…
    const row = Array.from({ length: 20 }, (_, x) => cellGlyph(r, x, 0)).join("");
    expect(row).toContain("g");
    // …and its first cell carries a non-zero link id in the attrs high byte.
    const gx = Array.from({ length: 20 }, (_, x) => cellGlyph(r, x, 0)).indexOf("g");
    expect(cellAttrs(r, gx, 0) >>> LINK_SHIFT).toBeGreaterThan(0);
    // The host registered the URI for staging.
    expect(app.context.links.entries()).toContainEqual([1, "https://x.io"]);
    app.unmount();
    r.free();
  });
});
