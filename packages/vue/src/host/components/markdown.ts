// `<markdown>` / `VuiMarkdown` — renders a markdown string into the terminal.
// Parsing (via `marked`) lives in `markdown-parser.ts`; this component maps the
// resulting block tree onto the built-in `box`/`text`/`span` kinds. Inline
// emphasis folds into native styled runs; fenced code is delegated to `<code>`
// with the same pluggable highlighter. No custom paint — pure composition.
import {
  type PropType,
  computed,
  defineComponent,
  h,
  type VNode,
} from "@vue/runtime-core";
import type { Highlighter } from "../highlighter.ts";
import {
  type MdBlock,
  type MdList,
  type MdSpan,
  parseMarkdown,
} from "../markdown-parser.ts";
import { useTheme } from "../../use-theme.ts";
import { VuiCode } from "./code.ts";
import type { Theme } from "../../theme.ts";

/** A long dash for `hr`; clipped to the available width by nowrap. */
const HR_RULE = "─".repeat(160);

export const VuiMarkdown = defineComponent({
  name: "VuiMarkdown",
  inheritAttrs: false,
  props: {
    /** Markdown source. */
    content: { type: String, default: "" },
    /** Highlighter for fenced code; defaults to the built-in highlight.js one. */
    highlighter: { type: Object as PropType<Highlighter>, default: undefined },
  },
  setup(props, { attrs }) {
    const theme = useTheme();
    const blocks = computed(() => parseMarkdown(props.content));

    return () => {
      const ctx: RenderCtx = { theme, highlighter: props.highlighter };
      const children = blocks.value.map((block, i) =>
        renderBlock(block, ctx, i > 0),
      );
      return h(
        "box",
        { flexDirection: "column", alignItems: "stretch", ...attrs },
        children,
      );
    };
  },
});

interface RenderCtx {
  theme: Theme;
  highlighter?: Highlighter;
}

/** Map one block to a vnode; `spaced` adds a blank-line gap above (between blocks). */
function renderBlock(block: MdBlock, ctx: RenderCtx, spaced: boolean): VNode {
  const margin: Record<string, unknown> = spaced ? { margin: { top: 1 } } : {};
  switch (block.type) {
    case "heading":
      return h(
        "text",
        { bold: true, fg: ctx.theme.markdownHeading, wrap: "word", ...margin },
        spanNodes(block.spans, ctx.theme),
      );
    case "paragraph":
      return h("text", { wrap: "word", ...margin }, spanNodes(block.spans, ctx.theme));
    case "code":
      return h(VuiCode, {
        text: block.text,
        lang: block.lang,
        highlighter: ctx.highlighter,
        ...margin,
      });
    case "list":
      return renderList(block, ctx, margin);
    case "blockquote":
      return h(
        "box",
        { flexDirection: "row", alignItems: "stretch", ...margin },
        [
          h("box", { width: 1, backgroundColor: ctx.theme.markdownBlockQuote }),
          h("box", { flexDirection: "column", alignItems: "stretch", margin: { left: 1 } },
            block.blocks.map((b, i) => renderBlock(b, ctx, i > 0)),
          ),
        ],
      );
    case "hr":
      return h("text", { fg: ctx.theme.markdownHorizontalRule, wrap: "nowrap", ...margin }, HR_RULE);
    case "table":
      return renderTable(block, ctx.theme, margin);
  }
}

function renderList(
  list: MdList,
  ctx: RenderCtx,
  margin: Record<string, unknown>,
): VNode {
  const rows = list.items.map((item, i) => {
    const bullet = list.ordered ? `${list.start + i}. ` : "• ";
    const bulletColor = list.ordered
      ? ctx.theme.markdownListEnumeration
      : ctx.theme.markdownListItem;
    const content: VNode[] = [
      h("text", { wrap: "word" }, spanNodes(item.spans, ctx.theme)),
    ];
    if (item.children) content.push(renderList(item.children, ctx, {}));
    return h("box", { flexDirection: "row", alignItems: "stretch" }, [
      h("text", { fg: bulletColor, wrap: "nowrap" }, bullet),
      h("box", { flexDirection: "column", alignItems: "stretch", flexGrow: 1 }, content),
    ]);
  });
  return h(
    "box",
    { flexDirection: "column", alignItems: "stretch", ...margin },
    rows,
  );
}

/** Minimal aligned table: padded cells joined by ` │ `, header bold. */
function renderTable(
  table: { header: MdSpan[][]; rows: MdSpan[][][] },
  theme: Theme,
  margin: Record<string, unknown>,
): VNode {
  const cols = table.header.length;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = plainLen(table.header[c] ?? []);
    for (const row of table.rows) w = Math.max(w, plainLen(row[c] ?? []));
    widths[c] = w;
  }

  const rowNodes: VNode[] = [];
  rowNodes.push(cellsRow(table.header, widths, theme, true));
  rowNodes.push(
    h(
      "text",
      { fg: theme.muted, wrap: "nowrap" },
      widths.map((w) => "─".repeat(w)).join("─┼─"),
    ),
  );
  for (const row of table.rows) rowNodes.push(cellsRow(row, widths, theme, false));

  return h(
    "box",
    { flexDirection: "column", alignItems: "stretch", ...margin },
    rowNodes,
  );
}

/** One table row as a single `<text>`: each cell's spans, padded, then a separator. */
function cellsRow(
  cells: MdSpan[][],
  widths: number[],
  theme: Theme,
  header: boolean,
): VNode {
  const children: (VNode | string)[] = [];
  for (let c = 0; c < widths.length; c++) {
    const spans = cells[c] ?? [{ text: "" }];
    const styled = header ? spans.map((s) => ({ ...s, bold: true })) : spans;
    children.push(...spanNodes(styled, theme));
    const padCount = widths[c]! - plainLen(spans);
    if (padCount > 0) children.push(" ".repeat(padCount));
    if (c < widths.length - 1) {
      children.push(h("span", { fg: theme.muted }, " │ "));
    }
  }
  return h("text", { wrap: "nowrap" }, children);
}

function plainLen(spans: MdSpan[]): number {
  let n = 0;
  for (const s of spans) n += s.text.length;
  return n;
}

/** Convert inline spans into `<span>` vnodes folding into the enclosing `<text>`. */
function spanNodes(spans: MdSpan[], theme: Theme): (VNode | string)[] {
  return spans.map((s) => {
    const props: Record<string, unknown> = {};
    if (s.bold) props.bold = true;
    if (s.italic) props.italic = true;
    if (s.strike) props.strikethrough = true;
    if (s.code) props.fg = theme.markdownCode;
    if (s.href !== undefined) {
      props.underline = true;
      props.fg = theme.markdownLink;
      props.link = s.href; // OSC 8 hyperlink target (clickable in supporting terminals)
    }
    return h("span", props, s.text);
  });
}
