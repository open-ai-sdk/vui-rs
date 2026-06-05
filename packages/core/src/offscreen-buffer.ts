// An offscreen cell buffer (the native `CellBuffer` behind `vui_cbuf_*`). It
// owns a standalone grid that canvas / buffered nodes draw into, then composite
// into the renderer's back buffer with `Renderer.blit`.
// `OptimizedBuffer`: draw primitives + an optional zero-copy typed-array view.
// Call `free()` exactly once when done — the instance must not be used after.
import { type Pointer, toArrayBuffer } from "bun:ffi";
import { loadNativeLib } from "./native/load-native-lib.ts";
import { CELL_BYTES, Status } from "./native/ffi-symbols.ts";
import { type TextStyle } from "./renderer.ts";

const DEFAULT_FG = 0xe5e5e5ff;
const DEFAULT_BG = 0x000000ff;
const encoder = new TextEncoder();

function check(status: number, op: string): void {
  if (status !== Status.OK) {
    throw new Error(`vui-core offscreen ${op} failed with status ${status}`);
  }
}

export class OffscreenBuffer {
  #lib = loadNativeLib();
  #ptr: Pointer;
  #width: number;
  #height: number;

  constructor(width: number, height: number) {
    const ptr = this.#lib.symbols.vui_cbuf_new(width, height);
    if (ptr === null) {
      throw new Error("vui-core: failed to allocate offscreen buffer");
    }
    this.#ptr = ptr;
    this.#width = width;
    this.#height = height;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  /** The native `*mut CellBuffer`. Used by `Renderer.blit`; do not retain across `free()`. */
  get nativePtr(): Pointer {
    return this.#ptr;
  }

  drawText(x: number, y: number, text: string, style: TextStyle = {}): void {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_cbuf_draw_text(
        this.#ptr, x, y, bytes, bytes.byteLength,
        style.fg ?? DEFAULT_FG, style.bg ?? DEFAULT_BG, style.attrs ?? 0,
      ),
      "draw_text",
    );
  }

  fillRect(x: number, y: number, w: number, h: number, bg: number): void {
    check(this.#lib.symbols.vui_cbuf_fill_rect(this.#ptr, x, y, w, h, bg), "fill_rect");
  }

  setCell(x: number, y: number, ch: number, style: TextStyle = {}): void {
    check(
      this.#lib.symbols.vui_cbuf_set_cell(
        this.#ptr, x, y, ch, style.fg ?? DEFAULT_FG, style.bg ?? DEFAULT_BG, style.attrs ?? 0,
      ),
      "set_cell",
    );
  }

  clear(bg: number = DEFAULT_BG): void {
    check(this.#lib.symbols.vui_cbuf_clear(this.#ptr, bg), "clear");
  }

  /** Reallocate to a new size (clears it). Any previously fetched view dangles after. */
  resize(width: number, height: number): void {
    check(this.#lib.symbols.vui_cbuf_resize(this.#ptr, width, height), "resize");
    this.#width = width;
    this.#height = height;
  }

  /**
   * Zero-copy `Uint8Array` view over the native cells (stride `CELL_BYTES`). The
   * view aliases native memory and dangles after `resize()`/`free()` — fetch a
   * fresh one each time. Same wide-glyph pairing caveat as `Renderer.backBufferView`.
   */
  view(): Uint8Array {
    const ptr = this.#lib.symbols.vui_cbuf_ptr(this.#ptr);
    if (ptr === null) {
      throw new Error("vui-core: offscreen buffer pointer is null");
    }
    const cells = Number(this.#lib.symbols.vui_cbuf_len(this.#ptr));
    return new Uint8Array(toArrayBuffer(ptr, 0, cells * CELL_BYTES));
  }

  /** Free the native buffer. Idempotent; the instance is unusable after. */
  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_cbuf_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
