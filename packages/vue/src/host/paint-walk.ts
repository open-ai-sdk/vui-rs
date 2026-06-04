// The JS paint walk — the twin of paint.rs `paint`/`paint_node`. Pre-order over
// the Renderable tree: accumulate the UNROUNDED absolute origin (so flush
// siblings round their shared edge identically), round this node's border box,
// intersect the clip, derive the content box (inset by border+padding), let the
// node draw itself (`renderSelf`), then recurse children clipped to the content
// box. The back buffer is cleared first and flushed (diff/emit) after — the JS
// host owns the buffer; the native tree compose is bypassed (`renderer.flush`).
import { NativePaintBuffer } from "./paint-buffer.ts";
import { type Clip, type HostContext, type PaintBuffer, type Renderable } from "./renderable.ts";

// Round half AWAY FROM ZERO, to match Rust `f32::round` exactly. `Math.round`
// rounds half toward +∞ (`Math.round(-0.5) === 0`), which would diverge from the
// Rust paint by one cell at a negative half-integer origin (off-screen / scrolled
// nodes). `Math.sign * round(abs)` reproduces Rust's rounding on both signs.
const round = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));

function intersect(a: Clip, b: Clip): Clip {
  return {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
}

const isEmpty = (c: Clip): boolean => c.x0 >= c.x1 || c.y0 >= c.y1;

export function runPaint(ctx: HostContext): void {
  const renderer = ctx.renderer;
  if (!renderer || !ctx.root) return;
  // Clear to the base background (matches the Rust compose's `back.clear`); the
  // root Renderable's bg fill then paints the canvas over it.
  renderer.clear();
  const buf = new NativePaintBuffer(renderer);
  const screen: Clip = { x0: 0, y0: 0, x1: renderer.width, y1: renderer.height };
  paintNode(buf, ctx.root, 0, 0, screen);
  renderer.flush();
}

function paintNode(buf: PaintBuffer, node: Renderable, parentX: number, parentY: number, clip: Clip): void {
  const b = node.rect;
  node.screenRect = null;
  if (!b) return;
  if (!node.paint.visible || node.paint.opacity <= 0) return; // is_drawable

  // Unrounded absolute origin; round both edges per node so flush siblings share one.
  const absX = parentX + b.x;
  const absY = parentY + b.y;
  const x0 = round(absX);
  const y0 = round(absY);
  const x1 = round(absX + b.w);
  const y1 = round(absY + b.h);
  node.screenRect = { x0, y0, x1, y1 };

  const nodeClip = intersect(clip, { x0, y0, x1, y1 });
  if (isEmpty(nodeClip)) return; // fully clipped: children too

  // Content box: inset by taffy's reserved border + padding on each side.
  const cx0 = x0 + round(b.border.left) + round(b.padding.left);
  const cy0 = y0 + round(b.border.top) + round(b.padding.top);
  const cx1 = x1 - round(b.border.right) - round(b.padding.right);
  const cy1 = y1 - round(b.border.bottom) - round(b.padding.bottom);
  const contentClip = intersect(nodeClip, { x0: cx0, y0: cy0, x1: cx1, y1: cy1 });

  node.renderSelf(buf, { x0, y0, x1, y1, clip: nodeClip, cx0, cy0, cx1, cy1, contentClip });

  // Children paint over this node, clipped to its content box; origin stays the
  // node's UNROUNDED absolute (taffy child positions are relative to it).
  for (const child of node.children) {
    paintNode(buf, child, absX, absY, contentClip);
  }
}
