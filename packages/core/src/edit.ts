// A safe handle over one native `Edit` node's `EditBuffer`. Like `VuiNode`, it
// owns no memory — it forwards typed calls by `(renderer, nodeId)`. The `<input>`
// binding drives editing entirely through these calls (no editing logic in JS):
// it forwards key motions/edits, then reads the value back to sync v-model.

import type { Pointer } from "bun:ffi";
import { type EditMotionCode, Status } from "./native/ffi-symbols.ts";
import type { NativeLib } from "./native/load-native-lib.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function check(status: number, op: string): void {
  if (status !== Status.OK) {
    throw new Error(`vui-core edit ${op} failed with status ${status}`);
  }
}

export class EditApi {
  #lib: NativeLib;
  #ptr: Pointer;
  #id: number;
  /** Reused read-back buffer; grown on demand so steady-state reads don't alloc. */
  #scratch = new Uint8Array(256);

  constructor(lib: NativeLib, ptr: Pointer, id: number) {
    this.#lib = lib;
    this.#ptr = ptr;
    this.#id = id;
  }

  insert(text: string): this {
    const bytes = encoder.encode(text);
    check(this.#lib.symbols.vui_edit_insert(this.#ptr, this.#id, bytes, bytes.byteLength), "insert");
    return this;
  }

  backspace(): this {
    check(this.#lib.symbols.vui_edit_backspace(this.#ptr, this.#id), "backspace");
    return this;
  }

  delete(): this {
    check(this.#lib.symbols.vui_edit_delete(this.#ptr, this.#id), "delete");
    return this;
  }

  move(motion: EditMotionCode): this {
    check(this.#lib.symbols.vui_edit_move(this.#ptr, this.#id, motion), "move");
    return this;
  }

  setValue(text: string): this {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_edit_set_value(this.#ptr, this.#id, bytes, bytes.byteLength),
      "set_value",
    );
    return this;
  }

  /** Read the current value. Grows the scratch buffer and retries if truncated. */
  getValue(): string {
    let need = Number(
      this.#lib.symbols.vui_edit_get_value(this.#ptr, this.#id, this.#scratch, this.#scratch.byteLength),
    );
    if (need > this.#scratch.byteLength) {
      this.#scratch = new Uint8Array(need);
      need = Number(
        this.#lib.symbols.vui_edit_get_value(this.#ptr, this.#id, this.#scratch, this.#scratch.byteLength),
      );
    }
    return decoder.decode(this.#scratch.subarray(0, need));
  }

  setCursor(index: number): this {
    check(this.#lib.symbols.vui_edit_set_cursor(this.#ptr, this.#id, index >>> 0), "set_cursor");
    return this;
  }

  /** `undefined`/`0` clears the cap (unbounded). */
  setMaxLength(max?: number): this {
    check(
      this.#lib.symbols.vui_edit_set_max_length(this.#ptr, this.#id, (max ?? 0) >>> 0),
      "set_max_length",
    );
    return this;
  }

  setPlaceholder(text: string): this {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_edit_set_placeholder(this.#ptr, this.#id, bytes, bytes.byteLength),
      "set_placeholder",
    );
    return this;
  }

  setFocused(focused: boolean): this {
    check(this.#lib.symbols.vui_edit_set_focused(this.#ptr, this.#id, focused ? 1 : 0), "set_focused");
    return this;
  }

  setCursorColor(rgba?: number): this {
    check(
      this.#lib.symbols.vui_edit_set_cursor_color(this.#ptr, this.#id, rgba ?? 0, rgba === undefined ? 0 : 1),
      "set_cursor_color",
    );
    return this;
  }

  setPlaceholderColor(rgba?: number): this {
    check(
      this.#lib.symbols.vui_edit_set_placeholder_color(
        this.#ptr,
        this.#id,
        rgba ?? 0,
        rgba === undefined ? 0 : 1,
      ),
      "set_placeholder_color",
    );
    return this;
  }
}
