// Lazy run-flattening for `<text>`. A `<text>`'s inline subtree (raw-text leaves
// plus virtual `span` nodes) is collapsed into an ordered list of styled runs on
// flush, then packed by one `setTextRuns` call. Span style folds down the chain:
// `fg`/`bg` are overridden by inner spans, attrs are OR-combined.
import type { TextRun } from "@vui-rs/core";
import type { RunStyle, VuiHostNode } from "./host-node.ts";

/** Flatten a `<text>` node's inline subtree into ordered styled runs. */
export function flattenRuns(textNode: VuiHostNode): TextRun[] {
  const out: TextRun[] = [];
  collectRuns(textNode, { attrs: 0 }, out);
  return out;
}

function collectRuns(node: VuiHostNode, inherited: RunStyle, out: TextRun[]): void {
  // A leaf whose content was set via `setElementText` (Vue's text-children fast
  // path) carries it in `directText` rather than a child raw-text node. This only
  // applies with no children; a node never holds both at once in Vue's flows.
  if (node.children.length === 0) {
    if (node.directText) out.push(makeRun(node.directText, inherited));
    return;
  }
  for (const child of node.children) {
    if (child.kind === "raw-text") {
      if (child.text.length > 0) out.push(makeRun(child.text, inherited));
    } else if (child.kind === "span") {
      collectRuns(child, mergeStyle(inherited, child.spanStyle), out);
    }
    // comment children are inert; box/text are rejected at insert time.
  }
}

function mergeStyle(base: RunStyle, add: RunStyle): RunStyle {
  return {
    fg: add.fg ?? base.fg,
    bg: add.bg ?? base.bg,
    attrs: (base.attrs | add.attrs) >>> 0,
  };
}

function makeRun(text: string, style: RunStyle): TextRun {
  const run: TextRun = { text };
  if (style.fg !== undefined) run.fg = style.fg;
  if (style.bg !== undefined) run.bg = style.bg;
  if (style.attrs) run.attrs = style.attrs;
  return run;
}
