import { overlaysInPaintOrder } from "./overlay.ts";
import type { HostContext, Renderable } from "./renderable.ts";

function contains(node: Renderable, x: number, y: number): boolean {
  const r = node.screenRect;
  return !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
}

/** Return the topmost painted Renderable at a 0-indexed terminal cell. */
export function hitTest(root: Renderable | null, x: number, y: number): Renderable | null {
  if (!root || !contains(root, x, y)) return null;
  let hit: Renderable = root;
  for (const child of root.children) {
    if (child.isOverlay) continue; // overlays are tested first, separately
    const childHit = hitTest(child, x, y);
    if (childHit) hit = childHit;
  }
  return hit;
}

/**
 * Hit-test honoring the overlay layer: the topmost overlay is checked first, so a
 * modal "eats" the click before the tree underneath. A backdrop overlay is modal
 * — it captures clicks even outside its content box (they don't fall through to
 * the dimmed layer behind). Falls through to the main tree when no overlay claims
 * the cell. The plain `hitTest(root, …)` is kept for tree-only callers.
 */
export function hitTestTopmost(ctx: HostContext, x: number, y: number): Renderable | null {
  const overlays = overlaysInPaintOrder(ctx);
  for (let i = overlays.length - 1; i >= 0; i--) {
    const ov = overlays[i]!;
    if (!ov.paint.visible) continue;
    const hit = hitTest(ov, x, y);
    if (hit) return hit;
    if (ov.paint.backdrop) return ov; // modal capture
  }
  return hitTest(ctx.root, x, y);
}
