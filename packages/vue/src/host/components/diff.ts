// `<diff>` / `VuiDiff` — a unified-diff viewer. Parses a `git diff`/`diff -u`
// patch and colors each line by kind: added (green), removed (red), context
// (default), hunk header (accent), file metadata (muted). An optional gutter
// shows old/new line numbers. Split mode is deferred — `mode` is accepted for
// forward-compatibility but currently always renders unified.
import {
  type PropType,
  computed,
  defineComponent,
  h,
} from "@vue/runtime-core";
import { parseColor } from "@vui-rs/core";
import { type DiffLine, parseUnifiedDiff } from "../diff-parser.ts";
import { useTheme } from "../../use-theme.ts";

/** Default kind colors; added/removed are deliberately diff-conventional. */
const ADDED = parseColor("#a6e3a1")!;
const REMOVED = parseColor("#f38ba8")!;

export const VuiDiff = defineComponent({
  name: "VuiDiff",
  inheritAttrs: false,
  props: {
    /** Unified-diff text (`git diff` output). */
    patch: { type: String, default: "" },
    /** `unified` (default). `split` is accepted but renders unified for now. */
    mode: { type: String as PropType<"unified" | "split">, default: "unified" },
    /** Render an old/new line-number gutter. */
    lineNumbers: { type: Boolean, default: false },
  },
  setup(props, { attrs }) {
    const theme = useTheme();
    const lines = computed(() => parseUnifiedDiff(props.patch));

    function colorFor(kind: DiffLine["kind"]): number {
      switch (kind) {
        case "add":
          return ADDED;
        case "del":
          return REMOVED;
        case "hunk":
          return theme.accent;
        case "meta":
          return theme.muted;
        default:
          return theme.fg;
      }
    }

    function marker(kind: DiffLine["kind"]): string {
      if (kind === "add") return "+";
      if (kind === "del") return "-";
      if (kind === "context") return " ";
      return "";
    }

    return () => {
      const ls = lines.value;
      const oldW = gutterWidth(ls, "oldNo");
      const newW = gutterWidth(ls, "newNo");
      const rows = ls.map((line) => {
        const fg = colorFor(line.kind);
        const text = `${marker(line.kind)}${line.text}` || " ";
        const content = h(
          "text",
          { fg, wrap: "nowrap", ...(props.lineNumbers ? { flexGrow: 1 } : {}) },
          text,
        );
        if (!props.lineNumbers) return content;
        const gutter = `${pad(line.oldNo, oldW)} ${pad(line.newNo, newW)} `;
        return h("box", { flexDirection: "row", alignItems: "stretch" }, [
          h("text", { fg: theme.muted, wrap: "nowrap" }, gutter),
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

function gutterWidth(lines: DiffLine[], key: "oldNo" | "newNo"): number {
  let max = 0;
  for (const l of lines) {
    const n = l[key];
    if (n !== undefined) max = Math.max(max, String(n).length);
  }
  return Math.max(1, max);
}

function pad(n: number | undefined, width: number): string {
  return (n === undefined ? "" : String(n)).padStart(width, " ");
}
