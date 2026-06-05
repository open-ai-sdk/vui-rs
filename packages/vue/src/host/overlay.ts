// The overlay/portal layer — how vui draws modals, dialogs, and toasts on top of
// the tree without the painter-order/clip constraints of normal flow. An
// `<overlay>` is a box whose layout node is hoisted under the renderer root (so
// taffy sizes it to the terminal, position:absolute inset:0 by default) and whose
// paint is deferred to a separate pass after the main walk — so it is never
// clipped by an ancestor's content box and always lands on top. The registry of
// live overlays lives on `HostContext.overlays`; node-ops registers/unregisters
// as overlays mount/unmount, and the paint walk drains it (low zIndex first).
//
// Backdrop dim is OPAQUE color-quantization: terminals have no real alpha, so a
// "dim" backdrop reads each covered cell and rewrites it darker (keeping its
// glyph). No ABI change, no per-subtree alpha — that is the deferred 01b work.
import { Attr, charWidth } from "@vui-rs/core";
import { BoxRenderable } from "./box-renderable.ts";
import {
  type Backdrop,
  type CellUnder,
  type Clip,
  type HostContext,
  type PaintBuffer,
  type Renderable,
} from "./renderable.ts";

/**
 * An `<overlay>` host node: a top-layer box laid out absolute over the whole
 * terminal. Defaults to filling the screen (`position:absolute`, all insets 0) so
 * a centered modal can flex-center within it and a backdrop covers everything;
 * authors override the layout props as usual.
 */
export class OverlayRenderable extends BoxRenderable {
  constructor(ctx: HostContext, tag: string) {
    super(ctx, tag);
    this.isOverlay = true;
    // Fill the terminal by default; modals center their content inside this.
    this.style.position = "absolute";
    (this.style as Record<string, unknown>).inset = 0;
  }
}

/** Track an overlay root so the paint walk's overlay pass draws it. */
export function registerOverlay(ctx: HostContext, node: Renderable): void {
  if (!ctx.overlays.includes(node)) ctx.overlays.push(node);
}

/** Drop an overlay root from the registry (on unmount). */
export function unregisterOverlay(ctx: HostContext, node: Renderable): void {
  const at = ctx.overlays.indexOf(node);
  if (at >= 0) ctx.overlays.splice(at, 1);
}

/** Overlays in paint order: low `zIndex` first, ties keep registration order. */
export function overlaysInPaintOrder(ctx: HostContext): Renderable[] {
  // Stable sort (Array.prototype.sort is stable) keyed only on zIndex, so the
  // common all-default case preserves mount order exactly.
  return [...ctx.overlays].sort((a, b) => a.paint.zIndex - b.paint.zIndex);
}

/** Scale a packed `0xRRGGBBAA` color's RGB toward black by `f` (0..1); alpha kept. */
function darken(packed: number, f: number): number {
  const r = Math.round(((packed >>> 24) & 0xff) * f);
  const g = Math.round(((packed >>> 16) & 0xff) * f);
  const b = Math.round(((packed >>> 8) & 0xff) * f);
  const a = packed & 0xff;
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

/**
 * Dim the region `[x0,x1) × [y0,y1)` (intersected with `clip`) in place: read
 * each cell, rewrite it with the same glyph/attrs but fg+bg scaled darker and
 * opaque. The opaque "dim" behind a modal — no alpha, no ABI change.
 *
 * Wide glyphs need care: rewriting a leader through `setCell` defuses its
 * `WIDE_CONTINUATION` neighbor (and vice versa), so a naive per-cell rewrite
 * would blank every CJK/emoji glyph it covers. Instead a wide leader is darkened
 * together with its continuation, written leader-then-continuation so the pair
 * is re-established rather than defused.
 *
 * The leader+continuation handling assumes the region spans full rows (the
 * overlay pass always passes the full screen). A sub-row region whose right edge
 * fell between a leader and its continuation could still defuse one half — widen
 * the pairing to read past `hi` if a partial-row backdrop is ever introduced.
 */
export function drawBackdrop(
  buf: PaintBuffer,
  clip: Clip,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  backdrop: Backdrop,
): void {
  const f = Math.max(0, Math.min(1, backdrop.darken));
  const lo = Math.max(x0, clip.x0);
  const hi = Math.min(x1, clip.x1);
  const top = Math.max(y0, clip.y0);
  const bot = Math.min(y1, clip.y1);
  const dim = (buf2: PaintBuffer, x: number, y: number, c: CellUnder): void =>
    buf2.setCell(x, y, c.ch, darken(c.fg, f), darken(c.bg, f), c.attrs, clip);
  for (let y = top; y < bot; y++) {
    for (let x = lo; x < hi; x++) {
      const cell = buf.cellUnder(x, y);
      // A wide leader still inside the region: darken it with its continuation in
      // one leader→continuation pass so the pair survives `setCell`'s defuse.
      if (!(cell.attrs & Attr.WIDE_CONTINUATION) && charWidth(cell.ch) === 2 && x + 1 < hi) {
        const cont = buf.cellUnder(x + 1, y);
        dim(buf, x, y, cell);
        dim(buf, x + 1, y, cont);
        x++; // skip the continuation just handled
        continue;
      }
      // Narrow cell, or a continuation whose leader is outside the region:
      // rewrite in place (keeping ch/attrs so a lone half stays a clean half).
      dim(buf, x, y, cell);
    }
  }
}
