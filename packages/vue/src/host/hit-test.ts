import type { Renderable } from "./renderable.ts";

function contains(node: Renderable, x: number, y: number): boolean {
  const r = node.screenRect;
  return !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
}

/** Return the topmost painted Renderable at a 0-indexed terminal cell. */
export function hitTest(root: Renderable | null, x: number, y: number): Renderable | null {
  if (!root || !contains(root, x, y)) return null;
  let hit: Renderable = root;
  for (const child of root.children) {
    const childHit = hitTest(child, x, y);
    if (childHit) hit = childHit;
  }
  return hit;
}
