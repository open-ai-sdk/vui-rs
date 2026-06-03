// An `<input>` host node — a single-line editable field. The edit model
// (graphemes/cursor/motion) currently lives in the native EditBuffer; under the
// JS host the value/placeholder/cursor are mirrored onto `edit` state here and
// painted by `renderSelf` (paint.rs `draw_edit`: value/placeholder, horizontal
// scroll, block cursor). Wiring keyboard editing onto this state is a later phase.
import { drawChrome, drawEdit } from "./paint-ops.ts";
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from "./renderable.ts";

/** Editable state surfaced to paint (cursor column, scroll offset, focus). */
export interface EditState {
  value: string;
  placeholder: string;
  cursor: number;
  focused: boolean;
  maxLength?: number;
  cursorColor?: number;
  placeholderColor?: number;
}

export class EditRenderable extends Renderable {
  edit: EditState = {
    value: "",
    placeholder: "",
    cursor: 0,
    focused: false,
  };

  constructor(ctx: HostContext, tag: string) {
    super(ctx, "edit", tag);
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint);
    drawEdit(buffer, ctx.contentClip, ctx.cx0, ctx.cy0, ctx.cx1, this.edit, this.paint);
  }
}
