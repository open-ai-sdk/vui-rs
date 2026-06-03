// An `<input>` host node — a single-line editable field. The edit model
// (graphemes/cursor/motion) currently lives in the native EditBuffer; under the
// JS host it is reached via a slim FFI or ported to JS (open question, resolved
// in a later phase). Phase 01 establishes the subclass and an `edit` state slot;
// `renderSelf` (value/cursor/scroll/placeholder) lands in Phase 04.
import { type HostContext, Renderable } from "./renderable.ts";

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
}
