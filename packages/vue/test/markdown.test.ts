import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { parseMarkdown, parseMarkdownIncremental, tokensToBlocks } from '../src/host/markdown-parser.ts'
import { VuiMarkdown } from '../src/host/components/markdown.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'
import { allGlyphs, cellAttrs, rowGlyphs } from './helpers/read-buffer.ts'

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

describe('markdown-parser', () => {
  test('headings carry level and inline emphasis', () => {
    const [h1] = parseMarkdown('# Hi **bold** _it_')
    expect(h1).toMatchObject({ type: 'heading', level: 1 })
    expect((h1 as { spans: unknown[] }).spans).toEqual([
      { text: 'Hi ' },
      { bold: true, text: 'bold' },
      { text: ' ' },
      { italic: true, text: 'it' },
    ])
  })

  test('nested lists, ordered start, and bullets', () => {
    const blocks = parseMarkdown('1. first\n2. second\n   - sub')
    const list = blocks[0] as { type: string; ordered: boolean; start: number; items: unknown[] }
    expect(list.type).toBe('list')
    expect(list.ordered).toBe(true)
    expect(list.start).toBe(1)
    expect((list.items[1] as { children?: unknown }).children).toMatchObject({
      type: 'list',
      ordered: false,
    })
  })

  test('fenced code keeps language and raw text', () => {
    const [code] = parseMarkdown('```ts\nconst x = 1;\n```')
    expect(code).toEqual({ type: 'code', text: 'const x = 1;', lang: 'ts' })
  })

  test('blockquote nests blocks; hr + link + codespan', () => {
    const [quote] = parseMarkdown('> quoted')
    expect(quote).toMatchObject({ type: 'blockquote' })
    const [link] = parseMarkdown('[label](http://x)')
    expect((link as { spans: unknown[] }).spans).toEqual([{ href: 'http://x', text: 'label' }])
    const [span] = parseMarkdown('`code`')
    expect((span as { spans: unknown[] }).spans).toEqual([{ code: true, text: 'code' }])
    const [hr] = parseMarkdown('---')
    expect(hr).toEqual({ type: 'hr' })
  })

  test('table header and rows', () => {
    const [table] = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(table).toMatchObject({ type: 'table' })
    const t = table as { header: unknown[][]; rows: unknown[][][] }
    expect(t.header).toEqual([[{ text: 'A' }], [{ text: 'B' }]])
    expect(t.rows).toEqual([[[{ text: '1' }], [{ text: '2' }]]])
  })

  test('empty content yields no blocks', () => {
    expect(parseMarkdown('')).toEqual([])
  })
})

describe('parseMarkdownIncremental', () => {
  test('reuses the unchanged token prefix across an append (no full re-lex)', () => {
    const first = '# Title\n\nfirst paragraph done.\n\n'
    const s1 = parseMarkdownIncremental(first, null, 2)
    // The settled heading token is the same object after appending more content —
    // i.e. it was carried over, not re-lexed.
    const s2 = parseMarkdownIncremental(first + 'second paragraph still typ', s1, 2)
    expect(s2.tokens[0]).toBe(s1.tokens[0])
    expect(s2.tokens[0]).toMatchObject({ type: 'heading' })
  })

  test('a clean parse (no prior state) matches the canonical full parse', () => {
    const doc = '# H\n\npara **bold**\n\n- a\n- b\n\n```ts\nlet y = 1\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |'
    const state = parseMarkdownIncremental(doc, null, 0)
    expect(tokensToBlocks(state.tokens)).toEqual(parseMarkdown(doc))
  })

  test('the growing tail re-lexes (newest text always reflected)', () => {
    const a = parseMarkdownIncremental('# Hi', null, 2)
    const b = parseMarkdownIncremental('# Hi there world', a, 2)
    const [heading] = tokensToBlocks(b.tokens) as [{ type: string; spans: { text: string }[] }]
    expect(heading.type).toBe('heading')
    expect(heading.spans.map((s) => s.text).join('')).toBe('Hi there world')
  })

  test('empty content resets state', () => {
    const s = parseMarkdownIncremental('', null, 2)
    expect(s).toEqual({ content: '', tokens: [], stableTokenCount: 0 })
  })
})

describe('VuiMarkdown render', () => {
  test('paints heading text bold + bullets + code', async () => {
    const { renderer, cleanup } = mount(30, 12, () =>
      h(VuiMarkdown, { content: '# Title\n\n- one\n\n```ts\nlet y=1\n```' }),
    )
    await nextTick()
    const glyphs = allGlyphs(renderer)
    expect(glyphs).toContain('Title')
    expect(glyphs).toContain('•')
    expect(glyphs).toContain('one')
    expect(glyphs).toContain('let')
    // Heading row is bold (attr bit 1 set on its first glyph).
    expect(cellAttrs(renderer, 0, 0) & 0x1).toBe(0x1)
    expect(rowGlyphs(renderer, 0).trimEnd()).toBe('Title')
    cleanup()
  })

  // The table fits columns to its MEASURED width (useElementRect), so settle a few
  // layout/render cycles for the re-measure to land before asserting.
  async function settle(app: { context: { flushNow: () => void } }): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await nextTick()
      app.context.flushNow()
    }
  }

  // The table fits to the width its container gives it; mirror the real transcript
  // by placing the markdown inside a definite-width column (otherwise an auto-width
  // ancestor would let it size to content and never wrap).
  const framed = (w: number, content: string) => () =>
    h('box', { width: w, flexDirection: 'column', alignItems: 'stretch' }, [h(VuiMarkdown, { content })])

  test('table renders inside a rounded border', async () => {
    const { app, renderer, cleanup } = mount(40, 12, framed(40, '| A | B |\n|---|---|\n| 1 | 2 |'))
    await settle(app)
    expect(allGlyphs(renderer)).toContain('╭') // rounded top-left corner
    expect(allGlyphs(renderer)).toContain('╯') // rounded bottom-right corner
    expect(allGlyphs(renderer)).toContain('A')
    expect(allGlyphs(renderer)).toContain('1')
    cleanup()
  })

  test('a long table cell wraps instead of overflowing off-screen', async () => {
    // A narrow terminal forces the long second-column cell to wrap to >1 row.
    const long = 'the quick brown fox jumps over the lazy dog repeatedly'
    const { app, renderer, cleanup } = mount(28, 16, framed(28, `| # | Note |\n|---|---|\n| 1 | ${long} |`))
    await settle(app)
    // Every word survives somewhere on screen (nothing clipped past the edge).
    const glyphs = allGlyphs(renderer)
    expect(glyphs).toContain('repeatedly')
    // The cell wrapped: 'fox' and 'repeatedly' land on different rows.
    let foxRow = -1
    let lastRow = -1
    for (let y = 0; y < 16; y++) {
      const row = rowGlyphs(renderer, y)
      if (row.includes('fox')) foxRow = y
      if (row.includes('repeatedly')) lastRow = y
    }
    expect(foxRow).toBeGreaterThanOrEqual(0)
    expect(lastRow).toBeGreaterThan(foxRow)
    cleanup()
  })

  test('a long list item wraps inside a bordered box instead of overpainting the border', async () => {
    // The compaction/summary shape: markdown inside an accent-bordered, padded box.
    // A list item is a flex ROW (bullet + growing content), so a long line must
    // shrink to the inner width and wrap — never lay out at its natural single-line
    // width and bleed across the right border.
    const long = '- the quick brown fox jumps over the lazy dog and then keeps on running'
    const bordered = () =>
      h('box', { width: 40, flexDirection: 'column', border: 'rounded', padding: { left: 1, right: 1 } }, [
        h(VuiMarkdown, { content: long }),
      ])
    const { app, renderer, cleanup } = mount(40, 16, bordered)
    await settle(app)
    const glyphs = allGlyphs(renderer)
    // Nothing clipped off-screen: the last word survives.
    expect(glyphs).toContain('running')
    // It actually wrapped: an early word and a late word land on different rows.
    let foxRow = -1
    let lastRow = -1
    for (let y = 0; y < 16; y++) {
      const row = rowGlyphs(renderer, y)
      if (row.includes('fox')) foxRow = y
      if (row.includes('running')) lastRow = y
    }
    expect(foxRow).toBeGreaterThanOrEqual(0)
    expect(lastRow).toBeGreaterThan(foxRow)
    // The right border (column 39) stays intact on every wrapped body row — text
    // never reached or overpainted it.
    for (let y = foxRow; y <= lastRow; y++) {
      expect(rowGlyphs(renderer, y)[39]).toBe('│')
    }
    cleanup()
  })

  test('a grapheme wider than its table column does not create a blank visual row', async () => {
    const { app, renderer, cleanup } = mount(8, 10, framed(5, '| A |\n|---|\n| 界 |'))
    await settle(app)
    const rows = Array.from({ length: 10 }, (_, y) => rowGlyphs(renderer, y))
    const ruleRow = rows.findIndex((row) => row.includes('│') && row.includes('─'))
    expect(ruleRow).toBeGreaterThanOrEqual(0)
    expect(rowGlyphs(renderer, ruleRow + 1)).toContain('界')
    cleanup()
  })

  test('reacts to content changes', async () => {
    const content = ref('alpha')
    const { app, renderer, cleanup } = mount(20, 6, () => h(VuiMarkdown, { content: content.value }))
    await nextTick()
    expect(allGlyphs(renderer)).toContain('alpha')
    content.value = 'omega'
    await nextTick()
    app.context.flushNow()
    const glyphs = allGlyphs(renderer)
    expect(glyphs).toContain('omega')
    expect(glyphs).not.toContain('alpha')
    cleanup()
  })

  test('streaming mode renders growing content correctly', async () => {
    const content = ref('# Title')
    const { app, renderer, cleanup } = mount(30, 8, () => h(VuiMarkdown, { content: content.value, streaming: true }))
    await nextTick()
    expect(allGlyphs(renderer)).toContain('Title')
    // Append a paragraph the way a stream would; the new block must appear.
    content.value = '# Title\n\nbody text here'
    await nextTick()
    app.context.flushNow()
    const glyphs = allGlyphs(renderer)
    expect(glyphs).toContain('Title')
    expect(glyphs).toContain('body')
    cleanup()
  })

  test('a table streamed in then settled renders as a bordered table, not paragraphs', async () => {
    // Reproduces the streaming hazard: a partial table lexes as paragraphs; once
    // the stream settles (streaming → false) it must render as a real table.
    const content = ref('| A | B |\n')
    const streaming = ref(true)
    const { app, renderer, cleanup } = mount(40, 12, () =>
      h('box', { width: 40, flexDirection: 'column', alignItems: 'stretch' }, [
        h(VuiMarkdown, { content: content.value, streaming: streaming.value }),
      ]),
    )
    await settle(app)
    content.value = '| A | B |\n|---|---|\n| 1 | 2 |'
    streaming.value = false
    await settle(app)
    const glyphs = allGlyphs(renderer)
    expect(glyphs).toContain('╭') // settled into a bordered table
    expect(glyphs).toContain('A')
    expect(glyphs).toContain('1')
    cleanup()
  })
})
