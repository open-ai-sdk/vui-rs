// `<markdown>` / `VuiMarkdown` — renders a markdown string into the terminal.
// Parsing (via `marked`) lives in `markdown-parser.ts`; this component maps the
// resulting block tree onto the built-in `box`/`text`/`span` kinds. Inline
// emphasis folds into native styled runs; fenced code is delegated to `<code>`
// with the same pluggable highlighter. No custom paint — pure composition.
import { type PropType, computed, defineComponent, h, ref, type VNode } from '@vue/runtime-core'
import { charWidth } from '@vui-rs/core'
import type { Highlighter } from '../highlighter.ts'
import { type MdBlock, type MdList, type MdSpan, parseMarkdown } from '../markdown-parser.ts'
import { useTheme } from '../../use-theme.ts'
import { useElementRect } from '../../use-element-rect.ts'
import { VuiCode } from './code.ts'
import type { Theme } from '../../theme.ts'

/** A long dash for `hr`; clipped to the available width by nowrap. */
const HR_RULE = '─'.repeat(160)

export const VuiMarkdown = defineComponent({
  name: 'VuiMarkdown',
  inheritAttrs: false,
  props: {
    /** Markdown source. */
    content: { type: String, default: '' },
    /** Highlighter for fenced code; defaults to the built-in highlight.js one. */
    highlighter: { type: Object as PropType<Highlighter>, default: undefined },
  },
  setup(props, { attrs }) {
    const theme = useTheme()
    const blocks = computed(() => parseMarkdown(props.content))

    return () => {
      const ctx: RenderCtx = { theme, highlighter: props.highlighter }
      const children = blocks.value.map((block, i) => renderBlock(block, ctx, i > 0))
      return h('box', { flexDirection: 'column', alignItems: 'stretch', ...attrs }, children)
    }
  },
})

interface RenderCtx {
  theme: Theme
  highlighter?: Highlighter
}

/** Map one block to a vnode; `spaced` adds a blank-line gap above (between blocks). */
function renderBlock(block: MdBlock, ctx: RenderCtx, spaced: boolean): VNode {
  const margin: Record<string, unknown> = spaced ? { margin: { top: 1 } } : {}
  switch (block.type) {
    case 'heading':
      return h(
        'text',
        { bold: true, fg: ctx.theme.markdownHeading, wrap: 'word', ...margin },
        spanNodes(block.spans, ctx.theme),
      )
    case 'paragraph':
      return h('text', { wrap: 'word', ...margin }, spanNodes(block.spans, ctx.theme))
    case 'code':
      return h(VuiCode, {
        text: block.text,
        lang: block.lang,
        highlighter: ctx.highlighter,
        ...margin,
      })
    case 'list':
      return renderList(block, ctx, margin)
    case 'blockquote':
      return h('box', { flexDirection: 'row', alignItems: 'stretch', ...margin }, [
        h('box', { width: 1, backgroundColor: ctx.theme.markdownBlockQuote }),
        h(
          'box',
          { flexDirection: 'column', alignItems: 'stretch', margin: { left: 1 } },
          block.blocks.map((b, i) => renderBlock(b, ctx, i > 0)),
        ),
      ])
    case 'hr':
      return h('text', { fg: ctx.theme.markdownHorizontalRule, wrap: 'nowrap', ...margin }, HR_RULE)
    case 'table':
      return h(MarkdownTable, { header: block.header, rows: block.rows, margin })
  }
}

function renderList(list: MdList, ctx: RenderCtx, margin: Record<string, unknown>): VNode {
  const rows = list.items.map((item, i) => {
    const bullet = list.ordered ? `${list.start + i}. ` : '• '
    const bulletColor = list.ordered ? ctx.theme.markdownListEnumeration : ctx.theme.markdownListItem
    const content: VNode[] = [h('text', { wrap: 'word' }, spanNodes(item.spans, ctx.theme))]
    if (item.children) content.push(renderList(item.children, ctx, {}))
    return h('box', { flexDirection: 'row', alignItems: 'stretch' }, [
      h('text', { fg: bulletColor, wrap: 'nowrap' }, bullet),
      h('box', { flexDirection: 'column', alignItems: 'stretch', flexGrow: 1 }, content),
    ])
  })
  return h('box', { flexDirection: 'column', alignItems: 'stretch', ...margin }, rows)
}

// Column separator (between cells) and its header-rule twin, kept the same width
// so the `─┼─` rule under the header lines up with the ` │ ` cell separators.
const CELL_SEP = ' │ '
const RULE_SEP = '─┼─'
// Width used to size columns before the table's real width is measured (first
// frame only; `useElementRect` corrects it on the next layout pass).
const FALLBACK_TABLE_WIDTH = 80

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Display width of a string in terminal cells (grapheme + `charWidth`, min 1/cell). */
function displayWidth(str: string): number {
  let w = 0
  for (const seg of segmenter.segment(str)) w += Math.max(charWidth(seg.segment.codePointAt(0) ?? 0), 1)
  return w
}

/** Total display width of a cell's spans. */
function spansWidth(spans: MdSpan[]): number {
  let w = 0
  for (const s of spans) w += displayWidth(s.text)
  return w
}

/**
 * Distribute `avail` cells across columns. Columns that fit at natural width keep
 * it; otherwise each is scaled proportionally with a small floor (so no column
 * vanishes), and any rounding overflow is trimmed off the widest columns so the
 * row never exceeds `avail`.
 */
function fitColumns(natural: number[], avail: number): number[] {
  const cols = natural.length
  if (cols === 0) return []
  const sum = natural.reduce((a, b) => a + b, 0) || 1
  if (sum <= avail) return natural.map((n) => Math.max(1, n))
  const min = Math.max(1, Math.min(6, Math.floor(avail / cols)))
  const widths = natural.map((n) => Math.max(min, Math.round((n / sum) * avail)))
  let over = widths.reduce((a, b) => a + b, 0) - avail
  while (over > 0) {
    let idx = -1
    let best = min
    for (let i = 0; i < widths.length; i++) {
      if (widths[i]! > best) {
        best = widths[i]!
        idx = i
      }
    }
    if (idx < 0) break
    widths[idx]!--
    over--
  }
  return widths
}

/**
 * Word-wrap a cell's styled spans to `width`, preserving each span's style on its
 * fragments. Returns one styled-span line per visual row (a word longer than the
 * column is hard-broken by grapheme). This is done in JS — rather than via a
 * wrapping `<text>` — because vui's flex layout mis-measures the HEIGHT of a
 * wrapped text when it has sibling rows (stacked rows would overlap). Each emitted
 * line becomes its own single-line `<text>`, whose height always measures as 1.
 */
function wrapSpans(spans: MdSpan[], width: number): MdSpan[][] {
  const w = Math.max(1, width)
  const lines: MdSpan[][] = []
  let line: MdSpan[] = []
  let lineW = 0
  const flush = (): void => {
    lines.push(line)
    line = []
    lineW = 0
  }
  for (const span of spans) {
    // Split into word / whitespace runs, keeping the separators.
    for (const part of span.text.split(/(\s+)/)) {
      if (part === '') continue
      const isSpace = /^\s+$/.test(part)
      const partW = displayWidth(part)
      if (isSpace) {
        if (lineW === 0) continue // trim leading space
        if (lineW + partW > w) {
          flush() // drop the space that would wrap
          continue
        }
        line.push({ ...span, text: part })
        lineW += partW
        continue
      }
      if (partW > w) {
        // Hard-break a token wider than the column, by grapheme.
        if (lineW > 0) flush()
        let chunk = ''
        let chunkW = 0
        for (const seg of segmenter.segment(part)) {
          const gw = Math.max(charWidth(seg.segment.codePointAt(0) ?? 0), 1)
          if (chunkW + gw > w) {
            line.push({ ...span, text: chunk })
            flush()
            chunk = seg.segment
            chunkW = gw
          } else {
            chunk += seg.segment
            chunkW += gw
          }
        }
        if (chunk) {
          line.push({ ...span, text: chunk })
          lineW = chunkW
        }
        continue
      }
      if (lineW + partW > w) flush()
      line.push({ ...span, text: part })
      lineW += partW
    }
  }
  if (line.length > 0 || lines.length === 0) flush()
  return lines
}

/** One logical table row → one `<text>` per visual (wrapped) line, columns aligned. */
function logicalRow(cells: MdSpan[][], widths: number[], theme: Theme, header: boolean): VNode[] {
  const cols = widths.length
  const wrapped = widths.map((w, c) => {
    let spans = cells[c] ?? [{ text: '' }]
    if (header) spans = spans.map((s) => ({ ...s, bold: true }))
    return wrapSpans(spans, w)
  })
  const lineCount = Math.max(1, ...wrapped.map((ls) => ls.length))
  const out: VNode[] = []
  for (let i = 0; i < lineCount; i++) {
    const children: (VNode | string)[] = []
    for (let c = 0; c < cols; c++) {
      const lineSpans = wrapped[c]![i] ?? []
      children.push(...spanNodes(lineSpans, theme))
      const pad = widths[c]! - spansWidth(lineSpans)
      if (pad > 0) children.push(' '.repeat(pad))
      if (c < cols - 1) children.push(h('span', { fg: theme.muted }, CELL_SEP))
    }
    out.push(h('text', { wrap: 'nowrap' }, children))
  }
  return out
}

/**
 * Aligned markdown table inside a rounded border (Amp-style). Column widths are fit
 * to the table's MEASURED width (`useElementRect`); each cell word-wraps so long
 * content reads on multiple lines instead of overflowing off-screen. Inline span
 * styling (bold / code / links) is preserved across wrapped lines.
 */
const MarkdownTable = defineComponent({
  name: 'MarkdownTable',
  props: {
    header: { type: Array as PropType<MdSpan[][]>, default: () => [] },
    rows: { type: Array as PropType<MdSpan[][][]>, default: () => [] },
    margin: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
  },
  setup(props) {
    const theme = useTheme()
    const boxRef = ref()
    const rect = useElementRect(boxRef)

    return () => {
      const cols = props.header.length
      // Natural column width = widest of header / any cell.
      const natural: number[] = []
      for (let c = 0; c < cols; c++) {
        let w = spansWidth(props.header[c] ?? [])
        for (const row of props.rows) w = Math.max(w, spansWidth(row[c] ?? []))
        natural[c] = Math.max(w, 1)
      }
      // Available width for cell content = box width − border (2) − padding (2) −
      // the inter-column separators. Falls back until the first layout measures it.
      const outer = rect.value?.width ?? FALLBACK_TABLE_WIDTH
      const sepTotal = Math.max(0, cols - 1) * CELL_SEP.length
      const avail = Math.max(cols, outer - 2 - 2 - sepTotal)
      const widths = fitColumns(natural, avail)

      const lineNodes: VNode[] = []
      lineNodes.push(...logicalRow(props.header, widths, theme, true))
      lineNodes.push(h('text', { wrap: 'nowrap', fg: theme.muted }, widths.map((w) => '─'.repeat(w)).join(RULE_SEP)))
      for (const row of props.rows) lineNodes.push(...logicalRow(row, widths, theme, false))

      return h(
        'box',
        {
          ref: boxRef,
          border: 'rounded',
          borderColor: theme.border,
          flexDirection: 'column',
          alignItems: 'stretch',
          width: { pct: 1 },
          // Clip the first (pre-measure) frame if the fallback width overshot; once
          // measured, content fits exactly so this never clips real content.
          overflow: 'hidden',
          padding: { left: 1, right: 1 },
          ...props.margin,
        },
        lineNodes,
      )
    }
  },
})

/** Convert inline spans into `<span>` vnodes folding into the enclosing `<text>`. */
function spanNodes(spans: MdSpan[], theme: Theme): (VNode | string)[] {
  return spans.map((s) => {
    const props: Record<string, unknown> = {}
    if (s.bold) props.bold = true
    if (s.italic) props.italic = true
    if (s.strike) props.strikethrough = true
    if (s.code) props.fg = theme.markdownCode
    if (s.href !== undefined) {
      props.underline = true
      props.fg = theme.markdownLink
      props.link = s.href // OSC 8 hyperlink target (clickable in supporting terminals)
    }
    return h('span', props, s.text)
  })
}
