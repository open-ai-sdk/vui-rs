// Off-paint geometry: compute an element's absolute screen rect from the laid-out
// `rect`s alone, without waiting for (or depending on) the paint walk. The twin of
// the absolute-origin accumulation in `paint-walk.ts` (`absX = parentX + b.x`,
// `childParentX = absX - scrollX`), unrolled as a walk UP the parent chain so a
// popup can anchor to another element right after layout, same frame. The paint
// walk caches `screenRect` on each node, but only post-paint; this reads fresh
// rects at the layout tick, so an anchored overlay never lags a frame behind.
import { round } from './paint-walk.ts'
import { type Renderable } from './renderable.ts'

/** Absolute screen rect in terminal cells (rounded to match painted cells). */
export interface ScreenMeasure {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The absolute screen rect of `node`'s border box, or `null` before the node (or
 * any ancestor) has been laid out. Accumulates each ancestor's parent-relative
 * origin minus its scroll offset (mirroring the paint walk), then rounds each edge
 * independently with the same rule paint uses — so `x0/y0` land on the same cells
 * the node paints into. An overlay-hoisted ancestor is laid out absolute under the
 * renderer root (the overlay pass paints it at the screen origin), so the walk
 * stops there: its `rect` origin is already absolute.
 */
export function getScreenRect(node: Renderable): ScreenMeasure | null {
  const self = node.rect
  if (!self) return null
  let x = self.x
  let y = self.y
  // A node's own scroll offsets its children, not itself — so start the ancestor
  // accumulation above `node` (unless `node` is itself a hoisted overlay root,
  // whose rect origin is already absolute and has no flow parent to climb).
  if (!node.isOverlay) {
    for (let n = node.parent; n; n = n.parent) {
      const r = n.rect
      if (!r) return null // an un-laid-out ancestor ⇒ no meaningful screen rect yet
      x += r.x - n.scrollX
      y += r.y - n.scrollY
      if (n.isOverlay) break // overlay origin is absolute under the root; stop climbing
    }
  }
  const x0 = round(x)
  const y0 = round(y)
  return { x: x0, y: y0, width: round(x + self.w) - x0, height: round(y + self.h) - y0 }
}
