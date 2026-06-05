import { describe, expect, test } from "bun:test";
import { Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { parseMarkdown } from "../src/host/markdown-parser.ts";
import { VuiMarkdown } from "../src/host/components/markdown.ts";
import { defineComponent, h, nextTick, ref } from "../src/index.ts";
import { allGlyphs, cellAttrs, rowGlyphs } from "./helpers/read-buffer.ts";

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return { app, renderer: r, cleanup: () => { app.unmount(); r.free(); } };
}

describe("markdown-parser", () => {
  test("headings carry level and inline emphasis", () => {
    const [h1] = parseMarkdown("# Hi **bold** _it_");
    expect(h1).toMatchObject({ type: "heading", level: 1 });
    expect((h1 as { spans: unknown[] }).spans).toEqual([
      { text: "Hi " },
      { bold: true, text: "bold" },
      { text: " " },
      { italic: true, text: "it" },
    ]);
  });

  test("nested lists, ordered start, and bullets", () => {
    const blocks = parseMarkdown("1. first\n2. second\n   - sub");
    const list = blocks[0] as { type: string; ordered: boolean; start: number; items: unknown[] };
    expect(list.type).toBe("list");
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect((list.items[1] as { children?: unknown }).children).toMatchObject({
      type: "list",
      ordered: false,
    });
  });

  test("fenced code keeps language and raw text", () => {
    const [code] = parseMarkdown("```ts\nconst x = 1;\n```");
    expect(code).toEqual({ type: "code", text: "const x = 1;", lang: "ts" });
  });

  test("blockquote nests blocks; hr + link + codespan", () => {
    const [quote] = parseMarkdown("> quoted");
    expect(quote).toMatchObject({ type: "blockquote" });
    const [link] = parseMarkdown("[label](http://x)");
    expect((link as { spans: unknown[] }).spans).toEqual([
      { href: "http://x", text: "label" },
    ]);
    const [span] = parseMarkdown("`code`");
    expect((span as { spans: unknown[] }).spans).toEqual([{ code: true, text: "code" }]);
    const [hr] = parseMarkdown("---");
    expect(hr).toEqual({ type: "hr" });
  });

  test("table header and rows", () => {
    const [table] = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(table).toMatchObject({ type: "table" });
    const t = table as { header: unknown[][]; rows: unknown[][][] };
    expect(t.header).toEqual([[{ text: "A" }], [{ text: "B" }]]);
    expect(t.rows).toEqual([[[{ text: "1" }], [{ text: "2" }]]]);
  });

  test("empty content yields no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("VuiMarkdown render", () => {
  test("paints heading text bold + bullets + code", async () => {
    const { renderer, cleanup } = mount(30, 12, () =>
      h(VuiMarkdown, { content: "# Title\n\n- one\n\n```ts\nlet y=1\n```" }),
    );
    await nextTick();
    const glyphs = allGlyphs(renderer);
    expect(glyphs).toContain("Title");
    expect(glyphs).toContain("•");
    expect(glyphs).toContain("one");
    expect(glyphs).toContain("let");
    // Heading row is bold (attr bit 1 set on its first glyph).
    expect(cellAttrs(renderer, 0, 0) & 0x1).toBe(0x1);
    expect(rowGlyphs(renderer, 0).trimEnd()).toBe("Title");
    cleanup();
  });

  test("reacts to content changes", async () => {
    const content = ref("alpha");
    const { app, renderer, cleanup } = mount(20, 6, () =>
      h(VuiMarkdown, { content: content.value }),
    );
    await nextTick();
    expect(allGlyphs(renderer)).toContain("alpha");
    content.value = "omega";
    await nextTick();
    app.context.flushNow();
    const glyphs = allGlyphs(renderer);
    expect(glyphs).toContain("omega");
    expect(glyphs).not.toContain("alpha");
    cleanup();
  });
});
