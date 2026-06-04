import type { Pointer } from "bun:ffi";
import { packTextRuns, type TextRun } from "../node.ts";
import { loadNativeLib } from "../native/load-native-lib.ts";
import { Status } from "../native/ffi-symbols.ts";

const encoder = new TextEncoder();

function check(status: number, op: string): void {
  if (status !== Status.OK)
    throw new Error(`vui-core ${op} failed with status ${status}`);
}

export class TextBuffer {
  #lib = loadNativeLib();
  #ptr: Pointer;

  constructor(text = "") {
    const ptr = this.#lib.symbols.vui_textbuf_new();
    if (ptr === null)
      throw new Error("vui-core: failed to allocate TextBuffer");
    this.#ptr = ptr;
    if (text) this.setText(text);
  }

  get nativePtr(): Pointer {
    return this.#ptr;
  }

  setText(text: string): void {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_textbuf_set_text(
        this.#ptr,
        bytes,
        bytes.byteLength,
      ),
      "textbuf_set_text",
    );
  }

  setRuns(runs: TextRun[]): void {
    const { bytes, runBytes } = packTextRuns(runs);
    check(
      this.#lib.symbols.vui_textbuf_set_runs(
        this.#ptr,
        runBytes,
        runs.length,
        bytes,
        bytes.byteLength,
      ),
      "textbuf_set_runs",
    );
  }

  lineCount(): number {
    return this.#lib.symbols.vui_textbuf_line_count(this.#ptr);
  }

  length(): number {
    return this.#lib.symbols.vui_textbuf_length(this.#ptr);
  }

  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_textbuf_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
