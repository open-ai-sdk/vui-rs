// Phase 02 (native dumb-buffer FFI): the JS-host draw surface. Clip-aware back-
// buffer primitives + an offscreen buffer (zero-copy round-trip) + a clipped
// blit. Reads cells back through the zero-copy typed-array view (stride 16).
import { describe, expect, test } from "bun:test";
import {
  CELL_BYTES,
  EXPECTED_ABI_VERSION,
  OffscreenBuffer,
  Renderer,
  getNativeLib,
  rgba,
} from "../src/index.ts";

/** Codepoint stored in cell `(x,y)` of a 16-byte-stride cell view. */
function glyphAt(view: Uint8Array, width: number, x: number, y: number): number {
  const base = (y * width + x) * CELL_BYTES;
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  return dv.getUint32(base, true); // ch is the first u32, little-endian
}

/** Packed bg color of cell `(x,y)` (offset 8 in the cell). */
function bgAt(view: Uint8Array, width: number, x: number, y: number): number {
  const base = (y * width + x) * CELL_BYTES + 8;
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  // Rgba is r,g,b,a bytes; repack to 0xRRGGBBAA to compare with rgba().
  return (
    ((dv.getUint8(base) << 24) |
      (dv.getUint8(base + 1) << 16) |
      (dv.getUint8(base + 2) << 8) |
      dv.getUint8(base + 3)) >>>
    0
  );
}

describe("ABI", () => {
  test("native ABI matches the expected version", () => {
    expect(getNativeLib().symbols.vui_abi_version()).toBe(EXPECTED_ABI_VERSION);
  });
});

describe("OffscreenBuffer", () => {
  test("zero-copy view round-trips drawn text", () => {
    const b = new OffscreenBuffer(4, 2);
    try {
      b.drawText(0, 0, "Hi");
      const view = b.view();
      expect(glyphAt(view, 4, 0, 0)).toBe("H".codePointAt(0));
      expect(glyphAt(view, 4, 1, 0)).toBe("i".codePointAt(0));
      expect(glyphAt(view, 4, 2, 0)).toBe(" ".codePointAt(0));
    } finally {
      b.free();
    }
  });

  test("fillRect colors the region; resize blanks", () => {
    const b = new OffscreenBuffer(3, 3);
    try {
      const red = rgba(255, 0, 0);
      b.fillRect(0, 0, 3, 3, red);
      expect(bgAt(b.view(), 3, 1, 1)).toBe(red);
      b.resize(2, 1);
      expect(b.width).toBe(2);
      expect(glyphAt(b.view(), 2, 0, 0)).toBe(" ".codePointAt(0));
    } finally {
      b.free();
    }
  });
});

describe("clip-aware back-buffer primitives", () => {
  test("drawTextClipped drops glyphs outside the clip", () => {
    const r = new Renderer(10, 1);
    try {
      r.drawTextClipped(0, 0, "abcdefg", {}, { x0: 2, y0: 0, x1: 5, y1: 1 });
      const view = r.backBufferView();
      expect(glyphAt(view, 10, 1, 0)).toBe(" ".codePointAt(0));
      expect(glyphAt(view, 10, 2, 0)).toBe("c".codePointAt(0));
      expect(glyphAt(view, 10, 4, 0)).toBe("e".codePointAt(0));
      expect(glyphAt(view, 10, 5, 0)).toBe(" ".codePointAt(0));
    } finally {
      r.free();
    }
  });

  test("fillRectClipped only fills inside the clip", () => {
    const r = new Renderer(6, 3);
    try {
      const blue = rgba(0, 0, 255);
      r.fillRectClipped(0, 0, 6, 3, blue, { x0: 1, y0: 1, x1: 4, y1: 2 });
      const view = r.backBufferView();
      expect(bgAt(view, 6, 0, 0)).not.toBe(blue);
      expect(bgAt(view, 6, 1, 1)).toBe(blue);
      expect(bgAt(view, 6, 3, 1)).toBe(blue);
      expect(bgAt(view, 6, 4, 1)).not.toBe(blue);
    } finally {
      r.free();
    }
  });
});

describe("blit", () => {
  test("composites an offscreen buffer into the back buffer, clipped", () => {
    const r = new Renderer(6, 6);
    const src = new OffscreenBuffer(2, 2);
    try {
      const green = rgba(0, 255, 0);
      src.fillRect(0, 0, 2, 2, green);
      src.setCell(0, 0, "q".codePointAt(0)!, { bg: green });
      // Place at (3,3) but clip to a single cell: only the top-left lands.
      r.blit(src, 3, 3, { x0: 3, y0: 3, x1: 4, y1: 4 });
      const view = r.backBufferView();
      expect(glyphAt(view, 6, 3, 3)).toBe("q".codePointAt(0));
      expect(bgAt(view, 6, 3, 3)).toBe(green);
      expect(bgAt(view, 6, 4, 3)).not.toBe(green); // clipped out
      expect(bgAt(view, 6, 3, 4)).not.toBe(green); // clipped out
    } finally {
      src.free();
      r.free();
    }
  });
});
