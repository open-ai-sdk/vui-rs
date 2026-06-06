// A `<box>` host node — the only flex container. Its `renderSelf` draws the
// chrome (background fill + border ring + title); children paint over it, clipped
// to its content box by the paint walk. Ports the box parts of paint.rs.
import { drawChrome } from "./paint-ops.ts";
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from "./renderable.ts";

export class BoxRenderable extends Renderable {
  constructor(ctx: HostContext, tag: string) {
    super(ctx, "box", tag);
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint, {
      fg: this.ctx.theme.fg,
      border: this.ctx.theme.border,
    });
  }
}
