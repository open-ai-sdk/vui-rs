// A `<text>` host node and the virtual inline nodes that fold into its native
// text-buffer runs. `span`/`raw-text`/`comment` own no rect and only contribute
// run style/strings to the enclosing `<text>`.
import { TextBuffer, TextBufferView, type TextWrapMode } from "@vui-rs/core";
import { drawChrome } from "./paint-ops.ts";
import {
  type HostContext,
  type PaintBuffer,
  type PaintCtx,
  Renderable,
} from "./renderable.ts";
import { flattenRuns } from "./runs.ts";

export class TextRenderable extends Renderable {
  textBuffer = new TextBuffer();
  textView = new TextBufferView(this.textBuffer, 1, "word");
  #synced = false;

  constructor(ctx: HostContext, tag: string) {
    super(ctx, "text", tag);
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint, {
      fg: this.ctx.theme.fg,
      border: this.ctx.theme.border,
    });
    this.syncTextBuffer();
    this.textView.setWidth(Math.max(1, ctx.cx1 - ctx.cx0));
    this.textView.setWrap(this.paint.wrap);
    buffer.drawTextBuffer(
      this.textView,
      ctx.cx0,
      ctx.cy0,
      this.paint.fg ?? this.ctx.theme.fg,
      this.paint.bg,
      this.paint.attrs,
      ctx.contentClip,
    );
  }

  syncTextBuffer(): void {
    if (this.#synced && !this.ctx.dirtyText.has(this)) return;
    this.textBuffer.setRuns(flattenRuns(this, this.ctx.links));
    this.#synced = true;
  }

  measure(
    width: number,
    mode: TextWrapMode = this.paint.wrap,
  ): { lineCount: number; maxWidth: number } {
    this.syncTextBuffer();
    return this.textView.measure(width, mode);
  }

  dispose(): void {
    this.textView.free();
    this.textBuffer.free();
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
