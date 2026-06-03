// The JS-host layout pass (L1: taffy-in-Rust via FFI). Flush each dirty
// Renderable's style + text-for-measure to its layout-only native node, run one
// `computeLayout` (no paint), then read every node's box back into `Renderable.
// rect`. Dirty-gated: an unchanged tree (and a non-first frame) does no FFI.
// The paint walk (Phase 04) then places each Renderable from its `rect`.
import { type HostContext, type Renderable } from "./renderable.ts";
import { flattenRuns } from "./runs.ts";

export function runLayout(ctx: HostContext): void {
  const renderer = ctx.renderer;
  if (!renderer || !ctx.root) return;

  const hadWork = ctx.dirtyLayout.size > 0 || ctx.dirtyText.size > 0;

  // 1. Push changed layout styles to the taffy nodes.
  for (const node of ctx.dirtyLayout) node.layoutNode?.setStyle(node.style);
  ctx.dirtyLayout.clear();

  // 2. Push changed text runs + wrap mode (these drive taffy's measure callback,
  //    which auto-sizes a `<text>` to its content via the shared wrap logic).
  for (const text of ctx.dirtyText) {
    const ln = text.layoutNode;
    if (!ln) continue;
    ln.setTextRuns(flattenRuns(text));
    ln.setTextWrap(text.paint.wrap);
  }
  ctx.dirtyText.clear();

  // Dirty-gate: skip the layout FFI when nothing changed and we already have rects.
  if (!hadWork && ctx.root.rect) return;

  renderer.computeLayout();
  readRects(ctx.root);
}

/** Walk the Renderable tree, reading each layout node's box into `rect`. */
function readRects(node: Renderable): void {
  if (node.layoutNode) {
    const rect = node.layoutNode.layoutRect();
    if (rect) node.rect = rect;
  }
  for (const child of node.children) readRects(child);
}
