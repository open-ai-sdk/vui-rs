import { type Pointer, toArrayBuffer } from "bun:ffi";
import { loadNativeLib } from "./native/load-native-lib.ts";
import { CELL_BYTES, Status } from "./native/ffi-symbols.ts";

/** Pack 8-bit channels into the `0xRRGGBBAA` u32 the FFI expects. */
export function rgba(r: number, g: number, b: number, a = 255): number {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
}

export interface TextStyle {
  fg?: number;
  bg?: number;
  attrs?: number;
}

const DEFAULT_FG = rgba(229, 229, 229);
const DEFAULT_BG = rgba(0, 0, 0);
const encoder = new TextEncoder();

function check(status: number, op: string): void {
  if (status !== Status.OK) {
    throw new Error(`vui-core ${op} failed with status ${status}`);
  }
}

/**
 * Thin, safe wrapper over the native renderer. Owns a `*mut Renderer` and
 * mirrors the draw primitives. Drawing mutates the back buffer; `render()`
 * diffs it against the screen and writes the minimal frame to stdout.
 *
 * Call `free()` exactly once when done — the instance must not be used after.
 */
export class Renderer {
  #lib = loadNativeLib();
  #ptr: Pointer;
  #width: number;
  #height: number;

  constructor(width: number, height: number) {
    const ptr = this.#lib.symbols.vui_renderer_new(width, height);
    if (ptr === null) {
      throw new Error("vui-core: failed to allocate renderer");
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

  drawText(x: number, y: number, text: string, style: TextStyle = {}): void {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_buffer_draw_text(
        this.#ptr,
        x,
        y,
        bytes,
        bytes.byteLength,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
      ),
      "draw_text",
    );
  }

  fillRect(x: number, y: number, w: number, h: number, bg: number): void {
    check(this.#lib.symbols.vui_buffer_fill_rect(this.#ptr, x, y, w, h, bg), "fill_rect");
  }

  setCell(x: number, y: number, ch: number, style: TextStyle = {}): void {
    check(
      this.#lib.symbols.vui_buffer_set_cell(
        this.#ptr,
        x,
        y,
        ch,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
      ),
      "set_cell",
    );
  }

  clear(bg: number = DEFAULT_BG): void {
    check(this.#lib.symbols.vui_buffer_clear(this.#ptr, bg), "clear");
  }

  /** Diff the back buffer and write the frame to stdout. */
  render(): void {
    check(this.#lib.symbols.vui_renderer_render(this.#ptr), "render");
  }

  /** Reallocate to a new size; forces a full repaint on the next `render()`. */
  resize(width: number, height: number): void {
    check(this.#lib.symbols.vui_renderer_resize(this.#ptr, width, height), "resize");
    this.#width = width;
    this.#height = height;
  }

  /**
   * Zero-copy `Uint8Array` view over the native back buffer (stride
   * `CELL_BYTES`). The view aliases native memory and is NOT lifetime-tracked:
   * it dangles after `resize()` (reallocates) or `free()` (deallocates). Do not
   * retain a view across either call — fetch a fresh one each time. Intended for
   * bulk writes and tests; prefer the draw methods for normal use. Raw writes
   * must uphold the wide-glyph pairing invariant the draw methods maintain: a
   * WIDE_CONTINUATION cell sits immediately right of a width-2 leader and only
   * there — so when clearing a continuation cell, also blank its leader (and
   * vice versa), or a half-glyph can linger on screen.
   */
  backBufferView(): Uint8Array {
    const ptr = this.#lib.symbols.vui_renderer_back_buffer_ptr(this.#ptr);
    if (ptr === null) {
      throw new Error("vui-core: back buffer pointer is null");
    }
    const cells = Number(this.#lib.symbols.vui_renderer_buffer_len(this.#ptr));
    return new Uint8Array(toArrayBuffer(ptr, 0, cells * CELL_BYTES));
  }

  /** Free the native renderer. Idempotent; the instance is unusable after. */
  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_renderer_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
