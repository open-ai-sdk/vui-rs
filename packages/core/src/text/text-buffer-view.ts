import type { Pointer } from "bun:ffi";
import { loadNativeLib } from "../native/load-native-lib.ts";
import { NativeTextWrap, Status, type NativeTextWrapCode } from "../native/ffi-symbols.ts";
import type { TextBuffer } from "./text-buffer.ts";

export type TextWrapMode = "nowrap" | "char" | "word";

export interface TextMeasure {
  lineCount: number;
  maxWidth: number;
}

function check(status: number, op: string): void {
  if (status !== Status.OK) throw new Error(`vui-core ${op} failed with status ${status}`);
}

export function wrapCode(mode: TextWrapMode): NativeTextWrapCode {
  switch (mode) {
    case "nowrap":
      return NativeTextWrap.None;
    case "char":
      return NativeTextWrap.Char;
    case "word":
      return NativeTextWrap.Word;
  }
}

export class TextBufferView {
  #lib = loadNativeLib();
  #ptr: Pointer;
  #measure = new Uint32Array(2);

  constructor(buffer: TextBuffer, width = 1, mode: TextWrapMode = "word") {
    const ptr = this.#lib.symbols.vui_textview_new(buffer.nativePtr);
    if (ptr === null) throw new Error("vui-core: failed to allocate TextBufferView");
    this.#ptr = ptr;
    this.setWidth(width);
    this.setWrap(mode);
  }

  get nativePtr(): Pointer {
    return this.#ptr;
  }

  setWidth(width: number): void {
    check(this.#lib.symbols.vui_textview_set_width(this.#ptr, Math.max(1, Math.floor(width))), "textview_set_width");
  }

  setWrap(mode: TextWrapMode): void {
    check(this.#lib.symbols.vui_textview_set_wrap(this.#ptr, wrapCode(mode)), "textview_set_wrap");
  }

  measure(width: number, mode: TextWrapMode = "word"): TextMeasure {
    check(
      this.#lib.symbols.vui_textview_measure(this.#ptr, Math.max(1, Math.floor(width)), wrapCode(mode), this.#measure),
      "textview_measure",
    );
    return { lineCount: this.#measure[0]!, maxWidth: this.#measure[1]! };
  }

  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_textview_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
