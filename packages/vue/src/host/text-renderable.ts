// A `<text>` host node and the virtual inline nodes that fold into its runs.
// `<text>` is a layout leaf auto-sized by its content (measure via wrap.ts);
// `span`/`raw-text`/`comment` own no rect and only contribute run style/strings
// to the enclosing `<text>`. `TextRenderable.renderSelf` draws the chrome then
// the wrapped runs (paint.rs `draw_runs`) into its content box.
import { drawChrome, drawRuns } from "./paint-ops.ts";
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from "./renderable.ts";
import { flattenRuns } from "./runs.ts";

export class TextRenderable extends Renderable {
  constructor(ctx: HostContext, tag: string) {
    super(ctx, "text", tag);
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint);
    drawRuns(buffer, ctx.contentClip, ctx.cx0, ctx.cy0, ctx.cx1, ctx.cy1, flattenRuns(this), this.paint);
  }
}

/** Inline run-style contributor (`<span>`/`<b>`/`<i>`/…). Virtual: no rect, no paint. */
export class SpanRenderable extends Renderable {
  constructor(ctx: HostContext, tag: string, spanAttrs: number) {
    super(ctx, "span", tag);
    this.spanStyle.attrs = spanAttrs;
  }
}

/** A string vnode (`#text`). Virtual; its `text` folds into the enclosing `<text>`. */
export class RawTextRenderable extends Renderable {
  constructor(ctx: HostContext, text: string) {
    super(ctx, "raw-text", "#text");
    this.text = text;
  }
}

/** A Vue fragment/`v-if`/`v-for` anchor (`#comment`). Inert; tracked for sibling walks. */
export class CommentRenderable extends Renderable {
  constructor(ctx: HostContext, text: string) {
    super(ctx, "comment", "#comment");
    this.text = text;
  }
}
