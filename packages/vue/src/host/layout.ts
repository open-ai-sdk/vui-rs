// The JS-host layout pass (L1: taffy-in-Rust via FFI). Flush each dirty
// Renderable's style + text-for-measure to its layout-only native node, run one
// `computeLayout` (no paint), then read every node's box back into `Renderable.
// rect`. Dirty-gated: an unchanged tree (and a non-first frame) does no FFI.
// The paint walk (Phase 04) then places each Renderable from its `rect`.
import { counters, perfEnabled, perfNow, recordDirty, recordReadRects } from './perf.ts'
import { type HostContext, type Renderable } from './renderable.ts'
import { flattenRuns } from './runs.ts'
import { type TextRenderable } from './text-renderable.ts'
import { type TextareaRenderable } from './textarea-renderable.ts'

export function runLayout(ctx: HostContext): void {
  const renderer = ctx.renderer
  if (!renderer || !ctx.root) return

  syncTextareaAutoSize(ctx.root)
  if (perfEnabled) recordDirty(ctx.dirtyLayout.size, ctx.dirtyText.size)
  const hadWork = ctx.dirtyLayout.size > 0 || ctx.dirtyText.size > 0

  // 1. Push changed layout styles to the taffy nodes.
  for (const node of ctx.dirtyLayout) node.layoutNode?.setStyle(node.style)
  ctx.dirtyLayout.clear()

  // 2. Push changed text runs + wrap mode (these drive taffy's measure callback,
  //    which auto-sizes a `<text>` to its content via the shared wrap logic).
  for (const text of ctx.dirtyText) {
    const ln = text.layoutNode
    if (!ln) continue
    if (text.kind === 'text') (text as TextRenderable).syncTextBuffer()
    ln.setTextRuns(flattenRuns(text))
    ln.setTextWrap(text.paint.wrap)
  }
  ctx.dirtyText.clear()

  // A terminal resize changes the root's available size without dirtying any
  // node, so it must force a relayout (else the tree stays at the old size and
  // the resized buffer shows unpainted area).
  const sizeChanged = ctx.layoutW !== renderer.width || ctx.layoutH !== renderer.height

  // Dirty-gate: skip the layout FFI when nothing changed, the size is unchanged,
  // and we already have rects.
  if (!hadWork && !sizeChanged && ctx.root.rect) return

  renderer.computeLayout()
  ctx.layoutW = renderer.width
  ctx.layoutH = renderer.height
  // Time readRects on its own — the per-node `layoutRect()` FFI fan-out is the
  // red-team's prime per-frame-cost suspect; `counters.layoutRectCalls` is bumped
  // inside the walk so the per-frame line shows whether it scales with all nodes.
  const r0 = perfNow()
  readRects(ctx.root)
  if (perfEnabled) recordReadRects(perfNow() - r0)
  // Layout actually recomputed — notify measurement subscribers (`useElementRect`)
  // so anchored popups re-read their element's screen rect off the fresh rects.
  // Skipped on the dirty-gated early return above (nothing moved ⇒ no re-measure).
  for (const listener of ctx.layoutListeners) listener()
}

function syncTextareaAutoSize(node: Renderable): void {
  if (node.kind === 'textarea') (node as TextareaRenderable).syncAutoSizeStyle()
  for (const child of node.children) syncTextareaAutoSize(child)
}

/** Walk the Renderable tree, reading each layout node's box into `rect`. */
function readRects(node: Renderable): void {
  if (node.layoutNode) {
    if (perfEnabled) counters.layoutRectCalls++
    const rect = node.layoutNode.layoutRect()
    if (rect) node.rect = rect
  }
  for (const child of node.children) readRects(child)
}
