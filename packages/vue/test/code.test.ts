import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { createDefaultHighlighter, defaultHighlighter } from '../src/host/highlighter.ts'
import { VuiCode } from '../src/host/components/code.ts'
import { defineComponent, h, nextTick } from '../src/index.ts'
import { allGlyphs, cellFg, rowGlyphs } from './helpers/read-buffer.ts'

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    renderer: r,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('highlighter', () => {
  test('colors keyword/string/comment and splits lines', () => {
    const lines = defaultHighlighter.highlight('const x = "hi"; // c', 'ts')
    expect(lines.length).toBe(1)
    const runs = lines[0]!
    // First run is the `const` keyword with a color set.
    expect(runs[0]!.text).toBe('const')
    expect(typeof runs[0]!.fg).toBe('number')
    // The comment run is italic (attr bit) and colored.
    const comment = runs.find((r) => r.text.includes('// c'))
    expect(comment?.attrs).toBeGreaterThan(0)
  })

  test('multiline source produces one StyledLine per line', () => {
    const lines = defaultHighlighter.highlight('let a=1\nlet b=2', 'ts')
    expect(lines.length).toBe(2)
    expect(lines[0]!.map((r) => r.text).join('')).toBe('let a=1')
  })

  test('language aliases resolve (ts/js/rs/py)', () => {
    for (const lang of ['ts', 'js', 'rs', 'py', 'go']) {
      const lines = defaultHighlighter.highlight('x', lang)
      expect(lines.length).toBe(1)
    }
  })

  test('unknown/omitted language falls back to plain runs (never throws)', () => {
    expect(defaultHighlighter.highlight('plain\ntext', 'zzz')).toEqual([[{ text: 'plain' }], [{ text: 'text' }]])
    expect(defaultHighlighter.highlight('nolang')).toEqual([[{ text: 'nolang' }]])
  })

  test('decodes HTML entities from highlight.js output', () => {
    const lines = defaultHighlighter.highlight('a < b && c > d', 'ts')
    const joined = lines[0]!.map((r) => r.text).join('')
    expect(joined).toBe('a < b && c > d')
  })

  test('out-of-range numeric entities are passed through, not thrown', () => {
    // Drive the entity decoder directly via a string literal containing a
    // numeric escape; the highlighter must not throw and must keep the source.
    const src = 'const s = "&#9999999999;";'
    expect(() => defaultHighlighter.highlight(src, 'ts')).not.toThrow()
    const joined = defaultHighlighter
      .highlight(src, 'ts')
      .flat()
      .map((r) => r.text)
      .join('')
    expect(joined).toContain('&#9999999999;')
  })

  test('custom palette overrides scope color', () => {
    const hl = createDefaultHighlighter({ keyword: '#ff0000' })
    const runs = hl.highlight('const x=1', 'ts')[0]!
    expect(runs[0]!.text).toBe('const')
    // #ff0000 packed as 0xRRGGBBAA = 0xff0000ff.
    expect(runs[0]!.fg).toBe(0xff0000ff)
  })
})

describe('VuiCode render', () => {
  test('renders highlighted code with colored keyword', async () => {
    const { renderer, cleanup } = mount(24, 4, () => h(VuiCode, { text: 'const x = 1;', lang: 'ts' }))
    await nextTick()
    expect(rowGlyphs(renderer, 0).trimEnd()).toBe('const x = 1;')
    // `const` keyword foreground is not the plain theme fg (it's colored).
    const fg = cellFg(renderer, 0, 0)
    expect(`${fg.r},${fg.g},${fg.b}`).not.toBe('205,214,244')
    cleanup()
  })

  test('line-number gutter is shown when enabled', async () => {
    const { renderer, cleanup } = mount(24, 4, () => h(VuiCode, { text: 'a\nb', lang: 'ts', lineNumbers: true }))
    await nextTick()
    expect(rowGlyphs(renderer, 0).trimStart().startsWith('1')).toBe(true)
    expect(rowGlyphs(renderer, 1).trimStart().startsWith('2')).toBe(true)
    cleanup()
  })

  test('plaintext (no lang) still renders the source', async () => {
    const { renderer, cleanup } = mount(20, 3, () => h(VuiCode, { text: 'just words' }))
    await nextTick()
    expect(allGlyphs(renderer)).toContain('justwords')
    cleanup()
  })
})
