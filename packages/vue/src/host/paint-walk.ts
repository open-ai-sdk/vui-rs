// The JS paint walk — the twin of paint.rs `paint`/`paint_node`. Pre-order over
// the Renderable tree: accumulate the UNROUNDED absolute origin (so flush
// siblings round their shared edge identically), round this node's border box,
// intersect the clip, derive the content box (inset by border+padding), let the
// node draw itself (`renderSelf`), then recurse children clipped to the content
// box. The back buffer is cleared first and flushed (diff/emit) after — the JS
// host owns the buffer; the native tree compose is bypassed (`renderer.flush`).
import { NativePaintBuffer } from './paint-buffer.ts'
import { drawBackdrop, overlaysInPaintOrder } from './overlay.ts'
import { type Clip, type HostContext, type PaintBuffer, type Renderable } from './renderable.ts'
import { paintSelection } from './selection.ts'

// Round half AWAY FROM ZERO, to match Rust `f32::round` exactly. `Math.round`
// rounds half toward +∞ (`Math.round(-0.5) === 0`), which would diverge from the
// Rust paint by one cell at a negative half-integer origin (off-screen / scrolled
// nodes). `Math.sign * round(abs)` reproduces Rust's rounding on both signs.
// Exported so the off-paint measurement walk (`measure.ts`) rounds a screen rect
// identically — a popup anchored to an element then lines up with its painted cells.
export const round = (v: number): number => Math.sign(v) * Math.round(Math.abs(v))

function intersect(a: Clip, b: Clip): Clip {
  return {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  }
}

const isEmpty = (c: Clip): boolean => c.x0 >= c.x1 || c.y0 >= c.y1

/**
 * Culling test: does a child's rounded border box fall entirely OUTSIDE `clip`?
 * If so the whole subtree is invisible and the paint walk skips it — so paint
 * cost scales with the number of VISIBLE nodes, not the total. Half-open math
 * mirrors `intersect`: border box `[x0,x1)×[y0,y1)` misses `clip` exactly when an
 * edge is on the wrong side. This is the same emptiness the per-node `nodeClip`
 * check (line below) would catch, hoisted before the recursive call so an
 * off-screen child costs one comparison instead of a function frame.
 *
 * Rect-based (not subtree-bounds): a child with `overflow:visible` could in
 * principle position a descendant back inside `clip` after its own box scrolled
 * out. That escape hatch is what overlays/portals are for; ordinary flow content
 * (lists, transcripts) stays within its box, so rect culling is exact for it.
 */
function cullsOut(child: Renderable, parentX: number, parentY: number, clip: Clip): boolean {
  const b = child.rect
  if (!b) return false // no rect yet — let paintNode bail on its own
  const x0 = round(parentX + b.x)
  const y0 = round(parentY + b.y)
  const x1 = round(parentX + b.x + b.w)
  const y1 = round(parentY + b.y + b.h)
  return x0 >= clip.x1 || x1 <= clip.x0 || y0 >= clip.y1 || y1 <= clip.y0
}

export function runPaint(ctx: HostContext): void {
  const renderer = ctx.renderer
  if (!renderer || !ctx.root) return
  // Clear to the base background (matches the Rust compose's `back.clear`); the
  // root Renderable's bg fill then paints the canvas over it.
  renderer.clear()
  // Image placements are re-staged by each <image> during this walk; clear last
  // frame's so a removed/moved image doesn't leave a stale placement registered.
  renderer.clearImagePlacements()
  const buf = new NativePaintBuffer(renderer)
  const screen: Clip = { x0: 0, y0: 0, x1: renderer.width, y1: renderer.height }
  paintNode(buf, ctx.root, 0, 0, screen)
  // Selection highlight sits over the content but under overlays (a modal should
  // cover it), so stamp it between the main tree and the overlay pass.
  paintSelection(renderer, ctx.selection)
  paintOverlays(buf, ctx, screen)
  // Re-stage the OSC 8 link table so the emitter can resolve each linked cell run
  // to its URI. The table is small (distinct links only) and ids are stable, so a
  // full re-stage each frame is cheap and keeps cached runs coherent.
  renderer.clearLinks()
  for (const [id, uri] of ctx.links.entries()) renderer.stageLink(id, uri)
  renderer.flush()
}

/**
 * The overlay pass: after the main tree, draw each registered overlay on top
 * (low zIndex first). Each paints at the screen origin with the full-screen clip
 * — overlays are hoisted under the renderer root, so they ignore ancestor clips.
 * A `backdrop` dims the whole screen first (opaque), so the modal sits over a
 * darkened layer.
 */
function paintOverlays(buf: PaintBuffer, ctx: HostContext, screen: Clip): void {
  if (ctx.overlays.length === 0) return
  for (const overlay of overlaysInPaintOrder(ctx)) {
    if (!overlay.paint.visible) continue
    // Each backdrop dims everything already drawn — including a lower overlay —
    // so stacked modals compound their dimming. That matches "this modal is in
    // front, everything behind it recedes".
    if (overlay.paint.backdrop) {
      drawBackdrop(buf, screen, screen.x0, screen.y0, screen.x1, screen.y1, overlay.paint.backdrop)
    }
    paintNode(buf, overlay, 0, 0, screen)
  }
}

/**
 * Children in paint order: stable-sorted by `zIndex` when any sibling sets a
 * non-default z, else the array as-is. Default (all z=0) returns the original
 * order untouched, so a tree with no z-index paints exactly as before (parity).
 */
function paintOrder(children: Renderable[]): Renderable[] {
  let needsSort = false
  for (const c of children) {
    if (c.paint.zIndex !== 0) {
      needsSort = true
      break
    }
  }
  if (!needsSort) return children
  // Decorate-sort to keep ties in document order (a plain comparator sort isn't
  // guaranteed stable across every engine for large arrays).
  return children
    .map((node, i) => ({ node, i }))
    .sort((a, b) => a.node.paint.zIndex - b.node.paint.zIndex || a.i - b.i)
    .map((e) => e.node)
}

function paintNode(buf: PaintBuffer, node: Renderable, parentX: number, parentY: number, clip: Clip): void {
  const b = node.rect
  node.screenRect = null
  if (!b) return
  if (!node.paint.visible || node.paint.opacity <= 0) return // is_drawable

  // Unrounded absolute origin; round both edges per node so flush siblings share one.
  const absX = parentX + b.x
  const absY = parentY + b.y
  const x0 = round(absX)
  const y0 = round(absY)
  const x1 = round(absX + b.w)
  const y1 = round(absY + b.h)
  node.screenRect = { x0, y0, x1, y1 }

  const nodeClip = intersect(clip, { x0, y0, x1, y1 })
  if (isEmpty(nodeClip)) return // fully clipped: children too

  // Content box: inset by taffy's reserved border + padding on each side.
  const cx0 = x0 + round(b.border.left) + round(b.padding.left)
  const cy0 = y0 + round(b.border.top) + round(b.padding.top)
  const cx1 = x1 - round(b.border.right) - round(b.padding.right)
  const cy1 = y1 - round(b.border.bottom) - round(b.padding.bottom)
  const contentClip = intersect(nodeClip, { x0: cx0, y0: cy0, x1: cx1, y1: cy1 })

  node.renderSelf(buf, { x0, y0, x1, y1, clip: nodeClip, cx0, cy0, cx1, cy1, contentClip })

  // Children paint over this node. `overflow:visible` (default) lets them spill
  // past the content box — they inherit only the ancestor clip; `hidden`/`scroll`
  // turn this node into a viewport that crops them to its content box. Scroll
  // offsets are paint-time only: layout stays full-size while descendants shift.
  const childClip = node.paint.overflow === 'visible' ? clip : contentClip
  const childParentX = absX - node.scrollX
  const childParentY = absY - node.scrollY
  for (const child of paintOrder(node.children)) {
    // Overlays are hoisted out of normal flow — drawn by the overlay pass, not
    // here (so an ancestor's content clip never crops a modal).
    if (child.isOverlay) continue
    // Cull subtrees that can't touch the clip region (off-screen / scrolled out).
    if (cullsOut(child, childParentX, childParentY, childClip)) {
      child.screenRect = null
      continue
    }
    paintNode(buf, child, childParentX, childParentY, childClip)
  }
}
