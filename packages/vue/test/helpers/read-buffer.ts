// Test helpers for reading painted output back from the native cell buffer.
// Cell layout is fixed by `#[repr(C)]`: 16 bytes = ch:u32 @0, fg:Rgba @4,
// bg:Rgba @8, attrs:u16 @12 (+2 pad). Used to assert theme/color defaults
// actually reached the screen.
import { CELL_BYTES, type Renderer } from "@vui-rs/core";

export interface Channels {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Split a packed `0xRRGGBBAA` into its channels. */
export function channels(packed: number): Channels {
  return {
    r: (packed >>> 24) & 0xff,
    g: (packed >>> 16) & 0xff,
    b: (packed >>> 8) & 0xff,
    a: packed & 0xff,
  };
}

function cellCount(buf: Uint8Array): number {
  return Math.floor(buf.byteLength / CELL_BYTES);
}

/** Index of the first non-blank cell (char that is neither space nor 0), or -1. */
function firstGlyphIndex(buf: Uint8Array): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < cellCount(buf); i++) {
    const ch = dv.getUint32(i * CELL_BYTES, true);
    if (ch !== 0x20 && ch !== 0) return i;
  }
  return -1;
}

/** The first painted (non-blank) glyph as a string, or null if the buffer is empty. */
export function firstGlyph(r: Renderer): string | null {
  const buf = r.backBufferView();
  const i = firstGlyphIndex(buf);
  if (i < 0) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return String.fromCodePoint(dv.getUint32(i * CELL_BYTES, true));
}

/** Foreground channels of the first painted glyph, or null if the buffer is empty. */
export function firstGlyphFg(r: Renderer): Channels | null {
  const buf = r.backBufferView();
  const i = firstGlyphIndex(buf);
  if (i < 0) return null;
  const base = i * CELL_BYTES;
  return {
    r: buf[base + 4]!,
    g: buf[base + 5]!,
    b: buf[base + 6]!,
    a: buf[base + 7]!,
  };
}

export function cellFg(r: Renderer, x: number, y: number): Channels {
  const buf = r.backBufferView();
  const base = (y * r.width + x) * CELL_BYTES;
  return {
    r: buf[base + 4]!,
    g: buf[base + 5]!,
    b: buf[base + 6]!,
    a: buf[base + 7]!,
  };
}

export function cellAttrs(r: Renderer, x: number, y: number): number {
  const buf = r.backBufferView();
  const base = (y * r.width + x) * CELL_BYTES + 12;
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(
    base,
    true,
  );
}

export function cellGlyph(r: Renderer, x: number, y: number): string {
  const buf = r.backBufferView();
  const base = (y * r.width + x) * CELL_BYTES;
  const ch = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(
    base,
    true,
  );
  return ch === 0 ? "" : String.fromCodePoint(ch);
}

export function rowGlyphs(r: Renderer, y: number): string {
  let out = "";
  for (let x = 0; x < r.width; x += 1) out += cellGlyph(r, x, y) || " ";
  return out;
}

/** Concatenate every non-blank glyph in row-major order — a coarse "what's on screen". */
export function allGlyphs(r: Renderer): string {
  const buf = r.backBufferView();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let out = "";
  for (let i = 0; i < cellCount(buf); i++) {
    const ch = dv.getUint32(i * CELL_BYTES, true);
    if (ch !== 0x20 && ch !== 0) out += String.fromCodePoint(ch);
  }
  return out;
}
