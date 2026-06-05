// `<code>` / `VuiCode` — a syntax-highlighted code block. The pluggable
// highlighter (default: highlight.js) turns `text` + `lang` into per-line styled
// runs, each line a `<text>` whose `<span>` children fold into native styled runs.
// An optional line-number gutter renders to the left. No custom paint: pure
// composition over the built-in `box`/`text`/`span` kinds.
import {
  type PropType,
  computed,
  defineComponent,
  h,
  type VNode,
} from "@vue/runtime-core";
import type { TextWrapMode } from "@vui-rs/core";
import {
  type Highlighter,
  type StyledLine,
  defaultHighlighter,
} from "../highlighter.ts";
import { useTheme } from "../../use-theme.ts";

/** Build the `<span>` children for one highlighted line (blank → a single space row). */
function lineSpans(line: StyledLine): VNode[] | string {
  if (line.length === 0) return " ";
  return line.map((run) => {
    const props: Record<string, unknown> = {};
    if (run.fg !== undefined) props.fg = run.fg;
    if (run.bg !== undefined) props.bg = run.bg;
    if (run.attrs) props.attrs = run.attrs;
    return h("span", props, run.text);
  });
}

export const VuiCode = defineComponent({
  name: "VuiCode",
  inheritAttrs: false,
  props: {
    /** Source code to render. */
    text: { type: String, default: "" },
    /** Language id/extension (ts, js, rust, python, go, …); omit for no color. */
    lang: { type: String, default: undefined },
    /** Swappable engine; defaults to the built-in highlight.js highlighter. */
    highlighter: { type: Object as PropType<Highlighter>, default: undefined },
    /** Render a left line-number gutter. */
    lineNumbers: { type: Boolean, default: false },
    /** Wrap mode for long lines; code defaults to `nowrap` (clip/scroll). */
    wrap: { type: String as PropType<TextWrapMode>, default: "nowrap" },
  },
  setup(props, { attrs }) {
    const theme = useTheme();
    const lines = computed(() =>
      (props.highlighter ?? defaultHighlighter).highlight(props.text, props.lang),
    );

    return () => {
      const ls = lines.value;
      const gutterWidth = String(ls.length).length;
      const rows = ls.map((line, i) => {
        const content = h(
          "text",
          { wrap: props.wrap, ...(props.lineNumbers ? { flexGrow: 1 } : {}) },
          lineSpans(line),
        );
        if (!props.lineNumbers) return content;
        const num = `${String(i + 1).padStart(gutterWidth, " ")} `;
        return h("box", { flexDirection: "row", alignItems: "stretch" }, [
          h("text", { fg: theme.muted, wrap: "nowrap" }, num),
          content,
        ]);
      });
      return h(
        "box",
        { flexDirection: "column", alignItems: "stretch", ...attrs },
        rows,
      );
    };
  },
});
