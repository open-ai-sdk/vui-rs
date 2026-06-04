// The native-backed paint surface for the JS walk. Writes go through the
// renderer's clip-aware prims (one FFI per op); `bgUnder` reads the live back
// buffer via the zero-copy view (the same native memory the writes mutate, so a
// read after a write is consistent — matching paint.rs's sequential bg_under).
import { CELL_BYTES, type OffscreenBuffer, type Renderer } from "@vui-rs/core";
import { type Clip, type PaintBuffer } from "./renderable.ts";

const DEFAULT_BG = 0x000000ff;

export class NativePaintBuffer implements PaintBuffer {
  #r: Renderer;
  #view: Uint8Array;
  #dv: DataView;
  #w: number;
  #h: number;

  constructor(renderer: Renderer) {
    this.#r = renderer;
    // Fetch the view once per paint pass (it dangles across resize/free, but no
    // resize happens mid-pass). Writes via the FFI prims alias this same memory.
    this.#view = renderer.backBufferView();
    this.#dv = new DataView(
      this.#view.buffer,
      this.#view.byteOffset,
      this.#view.byteLength,
    );
    this.#w = renderer.width;
    this.#h = renderer.height;
  }

  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    bg: number,
    clip: Clip,
  ): void {
    this.#r.fillRectClipped(x, y, w, h, bg, clip);
  }

  setCell(
    x: number,
    y: number,
    ch: number,
    fg: number,
    bg: number,
    attrs: number,
    clip: Clip,
  ): void {
    this.#r.setCellClipped(x, y, ch, { fg, bg, attrs }, clip);
  }

  drawText(
    x: number,
    y: number,
    text: string,
    fg: number,
    bg: number,
    attrs: number,
    clip: Clip,
  ): void {
    this.#r.drawTextClipped(x, y, text, { fg, bg, attrs }, clip);
  }

  drawEditor(
    view: import("@vui-rs/core").EditorView,
    x: number,
    y: number,
    fg: number,
    bg: number,
    cursorBg: number,
    attrs: number,
    clip: Clip,
  ): void {
    this.#r.drawEditor(view, x, y, { fg, bg, cursorBg, attrs }, clip);
  }

  drawTextBuffer(
    view: import("@vui-rs/core").TextBufferView,
    x: number,
    y: number,
    fg: number,
    bg: number | undefined,
    attrs: number,
    clip: Clip,
  ): void {
    this.#r.drawTextBuffer(view, x, y, { fg, bg, attrs }, clip);
  }

  blit(src: OffscreenBuffer, dstX: number, dstY: number, clip: Clip): void {
    this.#r.blit(src, dstX, dstY, clip);
  }

  /** Packed `0xRRGGBBAA` background currently in cell `(x,y)`; default bg off-buffer. */
  bgUnder(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.#w || y >= this.#h) return DEFAULT_BG;
    const base = (y * this.#w + x) * CELL_BYTES + 8; // bg is the 3rd field (offset 8)
    return (
      ((this.#dv.getUint8(base) << 24) |
        (this.#dv.getUint8(base + 1) << 16) |
        (this.#dv.getUint8(base + 2) << 8) |
        this.#dv.getUint8(base + 3)) >>>
      0
    );
  }
}
