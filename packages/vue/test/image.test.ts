// Inline images: encoding selection (env override + terminal detection), the
// half-block pixel→cell mapping, the native decode, and the `<image>` renderable
// end-to-end (decode + half-block paint into its laid-out box).
import { describe, expect, test } from 'bun:test'
import { type DecodedImage, decodeImage, decodeImageBytes, Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import {
  buildKittyTransmit,
  HALF_BLOCK,
  imageId,
  KITTY_PLACEHOLDER_CP,
  paintHalfBlock,
  selectImageEncoding,
} from '../src/host/image-encode.ts'
import { NativePaintBuffer } from '../src/host/paint-buffer.ts'
import { defineComponent, h } from '../src/index.ts'
import { cellBg, cellFg, cellGlyph } from './helpers/read-buffer.ts'

const FIXTURE = new URL('./fixtures/red-4x4.png', import.meta.url).pathname

describe('image encoding selection', () => {
  test('explicit override wins over detection', () => {
    expect(selectImageEncoding({ VUI_IMG_ENC: 'kitty' })).toBe('kitty')
    expect(selectImageEncoding({ VUI_IMG_ENC: 'iterm2' })).toBe('iterm2')
    expect(selectImageEncoding({ VUI_IMG_ENC: 'blocks' })).toBe('halfblock')
  })

  test('auto-detects kitty / iterm2, else half-block', () => {
    expect(selectImageEncoding({ KITTY_WINDOW_ID: '1' })).toBe('kitty')
    expect(selectImageEncoding({ TERM: 'xterm-ghostty' })).toBe('kitty')
    expect(selectImageEncoding({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2')
    expect(selectImageEncoding({ TERM: 'xterm-256color' })).toBe('halfblock')
    expect(selectImageEncoding({})).toBe('halfblock')
  })
})

describe('half-block mapping', () => {
  test('each cell takes the top pixel as fg, the bottom as bg, under ▀', () => {
    // 2×2: TL red, TR green, BL blue, BR white → one cell row of two cells.
    const rgba = new Uint8Array([
      255, 0, 0, 255, /* TL */ 0, 255, 0, 255 /* TR */, 0, 0, 255, 255, /* BL */ 255, 255, 255, 255 /* BR */,
    ])
    const img: DecodedImage = { width: 2, height: 2, rgba }
    const r = new Renderer(2, 1)
    const buf = new NativePaintBuffer(r)
    paintHalfBlock(buf, 0, 0, img, { x0: 0, y0: 0, x1: 2, y1: 1 })
    r.flush()
    expect(cellGlyph(r, 0, 0)).toBe(String.fromCodePoint(HALF_BLOCK))
    expect(cellFg(r, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 }) // top = red
    expect(cellBg(r, 0, 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 }) // bottom = blue
    expect(cellFg(r, 1, 0)).toEqual({ r: 0, g: 255, b: 0, a: 255 }) // top = green
    expect(cellBg(r, 1, 0)).toEqual({ r: 255, g: 255, b: 255, a: 255 }) // bottom = white
    r.free()
  })
})

describe('native decode', () => {
  test('decodes the fixture PNG and fits within a target box', () => {
    const full = decodeImage(FIXTURE)
    expect(full).not.toBeNull()
    expect(full!.width).toBe(4)
    expect(full!.height).toBe(4)
    expect(full!.rgba.length).toBe(4 * 4 * 4)
    expect([full!.rgba[0], full!.rgba[1], full!.rgba[2]]).toEqual([200, 10, 20])
    // Fit into 2×2 px.
    const small = decodeImage(FIXTURE, 2, 2)
    expect(small!.width).toBe(2)
    expect(small!.height).toBe(2)
  })

  test('a missing file decodes to null', () => {
    expect(decodeImage('/no/such/image.png')).toBeNull()
  })

  test('decodes from in-memory bytes (the remote/fetched path)', () => {
    const bytes = new Uint8Array(require('node:fs').readFileSync(FIXTURE))
    const img = decodeImageBytes(bytes)
    expect(img).not.toBeNull()
    expect([img!.width, img!.height]).toEqual([4, 4])
    expect([img!.rgba[0], img!.rgba[1], img!.rgba[2]]).toEqual([200, 10, 20])
    // Non-image bytes decode to null.
    expect(decodeImageBytes(new TextEncoder().encode('not an image'))).toBeNull()
  })
})

describe('<image> renderable', () => {
  test('half-block: decodes src and paints ▀ cells in its box', () => {
    const prev = process.env.VUI_IMG_ENC
    process.env.VUI_IMG_ENC = 'blocks' // deterministic regardless of host TERM
    try {
      const r = new Renderer(4, 2)
      const App = defineComponent({
        setup: () => () => h('image', { src: FIXTURE, width: 4, height: 2 }),
      })
      const app = createHostApp(App).mount({ renderer: r })
      // The 4×4 red image fits 4 cols × 4 px (2 cell rows) → ▀ cells in red.
      expect(cellGlyph(r, 0, 0)).toBe(String.fromCodePoint(HALF_BLOCK))
      expect(cellFg(r, 0, 0)).toEqual({ r: 200, g: 10, b: 20, a: 255 })
      app.unmount()
      r.free()
    } finally {
      if (prev === undefined) delete process.env.VUI_IMG_ENC
      else process.env.VUI_IMG_ENC = prev
    }
  })

  test('kitty: paints U+10EEEE placeholder cells with the id-encoded fg', () => {
    const prev = process.env.VUI_IMG_ENC
    process.env.VUI_IMG_ENC = 'kitty'
    try {
      const r = new Renderer(4, 2)
      const App = defineComponent({
        setup: () => () => h('image', { src: FIXTURE, width: 4, height: 2 }),
      })
      const app = createHostApp(App).mount({ renderer: r })
      // Every cell of the 4×2 box is the Kitty placeholder, fg = id (>>8, RGB).
      const id = imageId(FIXTURE, 4, 2)
      expect(cellGlyph(r, 0, 0)).toBe(String.fromCodePoint(KITTY_PLACEHOLDER_CP))
      expect(cellGlyph(r, 3, 1)).toBe(String.fromCodePoint(KITTY_PLACEHOLDER_CP))
      const fg = cellFg(r, 0, 0)
      expect((fg.r << 16) | (fg.g << 8) | fg.b).toBe(id)
      app.unmount()
      r.free()
    } finally {
      if (prev === undefined) delete process.env.VUI_IMG_ENC
      else process.env.VUI_IMG_ENC = prev
    }
  })
})

describe('kitty transmit', () => {
  test('builds a chunked APC _G sequence carrying the base64 RGBA', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(7)
    const seq = new TextDecoder().decode(buildKittyTransmit(42, { width: 4, height: 4, rgba }, 4, 2))
    expect(seq.startsWith('\x1b_Ga=T,f=32,t=d,i=42,s=4,v=4,c=4,r=2,U=1,q=2')).toBe(true)
    expect(seq.endsWith('\x1b\\')).toBe(true)
    expect(seq).toContain(Buffer.from(rgba).toString('base64').slice(0, 16))
  })
})
