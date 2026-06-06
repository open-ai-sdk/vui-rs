// Inline-image encoding: pick the best protocol the terminal supports and turn a
// decoded RGBA image into terminal output. Three tiers (mirrors 1s-cli's
// image_render.go): Kitty graphics (best fidelity) → iTerm2 inline → half-block
// (▀ colored cells; works on any truecolor terminal, fits the cell-diff model with
// zero escapes). Detection is best-effort via env vars; the user can force a tier
// with VUI_IMG_ENC = kitty | iterm2 | blocks | auto (default).
import { type DecodedImage } from '@vui-rs/core'
import { type Clip, type PaintBuffer } from './renderable.ts'

export type ImageEncoding = 'kitty' | 'iterm2' | 'halfblock'

/** Upper-half-block glyph: fg paints the top pixel row, bg the bottom. */
export const HALF_BLOCK = 0x2580 // ▀

/** Kitty Unicode placeholder codepoint (each cell of a placed image). */
export const KITTY_PLACEHOLDER_CP = 0x10eeee

/** Assumed cell pixel size for fitting a Kitty image (no reliable runtime query). */
export const CELL_PX_W = 8
export const CELL_PX_H = 16

/** Stable 24-bit, non-zero image id for a (src, cell-size) — encodes into the fg. */
export function imageId(src: string, cols: number, rows: number): number {
  let h = 0x811c9dc5
  const s = `${src}:${cols}x${rows}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h & 0xffffff || 1 // 24 bits (fits RGB fg), never 0 (0 = "no image")
}

type Env = Record<string, string | undefined>

function detectKitty(env: Env): boolean {
  const term = (env.TERM ?? '').toLowerCase()
  const prog = (env.TERM_PROGRAM ?? '').toLowerCase()
  return !!env.KITTY_WINDOW_ID || term.includes('kitty') || term.includes('ghostty') || prog.includes('ghostty')
}

function detectIterm2(env: Env): boolean {
  return env.TERM_PROGRAM === 'iTerm.app' || (env.LC_TERMINAL ?? '').toLowerCase().includes('iterm')
}

/**
 * Choose an encoding from an explicit override or terminal detection. Auto-order:
 * Kitty → iTerm2 → half-block (the universal fallback).
 */
export function selectImageEncoding(env: Env = process.env): ImageEncoding {
  switch ((env.VUI_IMG_ENC ?? '').toLowerCase().trim()) {
    case 'kitty':
      return 'kitty'
    case 'iterm2':
    case 'iterm':
      return 'iterm2'
    case 'blocks':
    case 'halfblock':
    case 'half-block':
      return 'halfblock'
  }
  if (detectKitty(env)) return 'kitty'
  if (detectIterm2(env)) return 'iterm2'
  return 'halfblock'
}

/** Pack an RGBA pixel at byte offset `o` into the renderer's `0xRRGGBBAA` form. */
function pixel(rgba: Uint8Array, o: number): number {
  return ((rgba[o]! << 24) | (rgba[o + 1]! << 16) | (rgba[o + 2]! << 8) | 0xff) >>> 0
}

/**
 * Paint `img` as half-block cells into `buf` at content origin `(cx0, cy0)`,
 * clipped. The image is expected to be fitted to at most `cols × 2·rows` pixels
 * (one cell column per pixel column, two pixel rows per cell). Each cell takes the
 * top pixel as fg and the bottom pixel as bg under a `▀`; an odd final pixel row
 * leaves the bottom transparent (kept from the background under the cell).
 */
export function paintHalfBlock(buf: PaintBuffer, cx0: number, cy0: number, img: DecodedImage, clip: Clip): void {
  const { width, height, rgba } = img
  const usedRows = Math.ceil(height / 2)
  for (let cy = 0; cy < usedRows; cy++) {
    const topY = cy * 2
    const botY = topY + 1
    for (let cx = 0; cx < width; cx++) {
      const fg = pixel(rgba, (topY * width + cx) * 4)
      if (botY < height) {
        const bg = pixel(rgba, (botY * width + cx) * 4)
        buf.setCell(cx0 + cx, cy0 + cy, HALF_BLOCK, fg, bg, 0, clip)
      } else {
        // Odd row count: bottom half keeps whatever is under the cell.
        const bg = buf.bgUnder(cx0 + cx, cy0 + cy)
        buf.setCell(cx0 + cx, cy0 + cy, HALF_BLOCK, fg, bg, 0, clip)
      }
    }
  }
}

/**
 * Build the Kitty graphics transmit sequence for a virtual (Unicode-placeholder)
 * placement: an APC `_G` command carrying the RGBA pixels base64'd and chunked at
 * 4096 bytes, displayed across `cols × rows` cells. Emitted once per (image, size)
 * via the renderer passthrough; the terminal caches it by `id` and the placeholder
 * cells reference it. `a=T` transmit+place, `U=1` unicode placeholder, `q=2` quiet.
 */
export function buildKittyTransmit(id: number, img: DecodedImage, cols: number, rows: number): Uint8Array {
  const b64 = Buffer.from(img.rgba).toString('base64')
  const CHUNK = 4096
  const head = `a=T,f=32,t=d,i=${id},s=${img.width},v=${img.height},c=${cols},r=${rows},U=1,q=2`
  let out = ''
  if (b64.length === 0) {
    return new TextEncoder().encode(`\x1b_G${head},m=0;\x1b\\`)
  }
  for (let off = 0; off < b64.length; off += CHUNK) {
    const slice = b64.slice(off, off + CHUNK)
    const more = off + CHUNK < b64.length ? 1 : 0
    out += off === 0 ? `\x1b_G${head},m=${more};${slice}\x1b\\` : `\x1b_Gm=${more};${slice}\x1b\\`
  }
  return new TextEncoder().encode(out)
}

/** Pack a 24-bit image id into the `0xRRGGBBAA` fg the emitter decodes it from. */
export function imageIdToFg(id: number): number {
  const r = (id >> 16) & 0xff
  const g = (id >> 8) & 0xff
  const b = id & 0xff
  return ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
}

/**
 * Paint a `cols × rows` block of Kitty placeholder cells at `(cx0, cy0)`. Each
 * cell is `U+10EEEE` with the image id encoded in its fg; the renderer expands it
 * into placeholder + row/col diacritics at emit time using the staged placement.
 */
export function paintKittyPlaceholders(
  buf: PaintBuffer,
  cx0: number,
  cy0: number,
  cols: number,
  rows: number,
  id: number,
  clip: Clip,
): void {
  const fg = imageIdToFg(id)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      buf.setCell(cx0 + c, cy0 + r, KITTY_PLACEHOLDER_CP, fg, 0, 0, clip)
    }
  }
}
