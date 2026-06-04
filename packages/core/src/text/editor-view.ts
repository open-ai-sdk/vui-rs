import type { Pointer } from "bun:ffi";
import { loadNativeLib } from "../native/load-native-lib.ts";
import { Status } from "../native/ffi-symbols.ts";
import type { EditMotionCode } from "../native/ffi-symbols.ts";
import type { EditBuffer } from "./edit-buffer.ts";
import { wrapCode, type TextWrapMode } from "./text-buffer-view.ts";

function check(status: number, op: string): void {
  if (status !== Status.OK)
    throw new Error(`vui-core ${op} failed with status ${status}`);
}

export class EditorView {
  #lib = loadNativeLib();
  #ptr: Pointer;
  #measure = new Uint32Array(2);

  constructor(
    edit: EditBuffer,
    width = 1,
    height = 1,
    mode: TextWrapMode = "word",
  ) {
    const ptr = this.#lib.symbols.vui_editor_new(
      edit.nativePtr,
      Math.max(1, width),
      Math.max(1, height),
    );
    if (ptr === null)
      throw new Error("vui-core: failed to allocate EditorView");
    this.#ptr = ptr;
    this.setWrap(mode);
  }

  get nativePtr(): Pointer {
    return this.#ptr;
  }

  setWrap(mode: TextWrapMode): void {
    check(
      this.#lib.symbols.vui_editor_set_wrap(this.#ptr, wrapCode(mode)),
      "editor_set_wrap",
    );
  }

  setViewport(width: number, height: number): void {
    check(
      this.#lib.symbols.vui_editor_set_viewport(
        this.#ptr,
        Math.max(1, Math.floor(width)),
        Math.max(1, Math.floor(height)),
      ),
      "editor_set_viewport",
    );
  }

  setFocused(focused: boolean): void {
    check(
      this.#lib.symbols.vui_editor_set_focused(this.#ptr, focused ? 1 : 0),
      "editor_set_focused",
    );
  }

  move(motion: EditMotionCode, selecting = false): void {
    check(
      this.#lib.symbols.vui_editor_move(this.#ptr, motion, selecting ? 1 : 0),
      "editor_move",
    );
  }

  measure(
    width: number,
    mode: TextWrapMode = "word",
  ): { lineCount: number; maxWidth: number } {
    check(
      this.#lib.symbols.vui_editor_measure(
        this.#ptr,
        Math.max(1, Math.floor(width)),
        wrapCode(mode),
        this.#measure,
      ),
      "editor_measure",
    );
    return { lineCount: this.#measure[0]!, maxWidth: this.#measure[1]! };
  }

  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_editor_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
