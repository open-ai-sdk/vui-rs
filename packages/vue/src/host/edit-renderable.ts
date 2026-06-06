// An `<input>` host node — a single-line editable field. Under the JS host the
// edit model (graphemes + cursor + motion) lives HERE in JS (the FFI host kept it
// in the native EditBuffer). `renderSelf` paints the value/placeholder + block
// cursor with horizontal scroll (paint.rs `draw_edit`); the host `<VuiHostInput>`
// component drives these ops from keyboard events delivered by the focus manager.
import { EditMotion } from "@vui-rs/core";
import { drawChrome, drawEdit } from "./paint-ops.ts";
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from "./renderable.ts";

/** Editable state surfaced to paint (cursor is a grapheme index; column is derived). */
export interface EditState {
  value: string;
  placeholder: string;
  cursor: number;
  focused: boolean;
  maxLength?: number;
  cursorColor?: number;
  placeholderColor?: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (s: string): string[] => {
  const out: string[] = [];
  for (const seg of segmenter.segment(s)) out.push(seg.segment);
  return out;
};
const isSpace = (g: string): boolean => g.trim() === "";

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
    const themeFg = this.ctx.theme.fg;
    drawChrome(buffer, ctx, this.paint, { fg: themeFg, border: this.ctx.theme.border });
    drawEdit(buffer, ctx.contentClip, ctx.cx0, ctx.cy0, ctx.cx1, this.edit, this.paint, themeFg);
  }

  // --- JS edit model: grapheme-indexed cursor, motions, and editing. ---

  getValue(): string {
    return this.edit.value;
  }

  /** External value write (v-model): replace, cursor to end. No change emit. */
  setValue(text: string): void {
    this.edit.value = text;
    this.edit.cursor = graphemes(text).length;
    this.#touch();
  }

  insert(text: string): void {
    const gs = graphemes(this.edit.value);
    let ins = graphemes(text);
    if (this.edit.maxLength !== undefined) {
      const room = this.edit.maxLength - gs.length;
      if (room <= 0) return;
      if (ins.length > room) ins = ins.slice(0, room);
    }
    gs.splice(this.edit.cursor, 0, ...ins);
    this.edit.value = gs.join("");
    this.edit.cursor += ins.length;
    this.#touch();
  }

  backspace(): void {
    if (this.edit.cursor <= 0) return;
    const gs = graphemes(this.edit.value);
    gs.splice(this.edit.cursor - 1, 1);
    this.edit.value = gs.join("");
    this.edit.cursor -= 1;
    this.#touch();
  }

  delete(): void {
    const gs = graphemes(this.edit.value);
    if (this.edit.cursor >= gs.length) return;
    gs.splice(this.edit.cursor, 1);
    this.edit.value = gs.join("");
    this.#touch();
  }

  move(motion: number): void {
    const gs = graphemes(this.edit.value);
    const len = gs.length;
    let c = this.edit.cursor;
    switch (motion) {
      case EditMotion.Left:
        c = Math.max(0, c - 1);
        break;
      case EditMotion.Right:
        c = Math.min(len, c + 1);
        break;
      case EditMotion.Home:
        c = 0;
        break;
      case EditMotion.End:
        c = len;
        break;
      case EditMotion.WordLeft:
        while (c > 0 && isSpace(gs[c - 1]!)) c--;
        while (c > 0 && !isSpace(gs[c - 1]!)) c--;
        break;
      case EditMotion.WordRight:
        while (c < len && isSpace(gs[c]!)) c++;
        while (c < len && !isSpace(gs[c]!)) c++;
        break;
    }
    this.edit.cursor = c;
    this.#touch();
  }

  #touch(): void {
    this.markDirty();
    this.ctx.scheduleRender();
  }
}
