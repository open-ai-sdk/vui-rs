// A `<box>` host node — the only flex container. Phase 01 just establishes the
// subclass; its `renderSelf` (background fill + border ring + title) lands in
// Phase 04, porting paint.rs `fill`/`draw_border`/`draw_title`.
import { type HostContext, Renderable } from "./renderable.ts";

export class BoxRenderable extends Renderable {
  constructor(ctx: HostContext, tag: string) {
    super(ctx, "box", tag);
  }
}
