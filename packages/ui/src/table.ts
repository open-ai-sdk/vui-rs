// `VuiTable` — a tabular layout of plain-string cells. Auto-sized (or fixed-width)
// columns, a bold/muted header row over a `─┼─` separator, cells joined by ` │ `,
// and an optional rounded-bordered variant. Pure composition of `<box>`/`<text>` —
// NO custom paint — mirroring the markdown table in @vui-rs/vue, generalized to
// arbitrary data + per-column alignment + display-width-correct column sizing.
//
// SECURITY: cells are rendered verbatim. The consumer MUST pass already-sanitized
// display strings (no control chars / escape sequences); this component does not
// parse or escape markup.
import { type PropType, computed, defineComponent, h, type VNode } from '@vue/runtime-core'
import { charWidth } from '@vui-rs/core'
import { useTheme } from '@vui-rs/vue'

export interface TableColumn {
  /** Key into each row record. */
  key: string
  /** Header label shown in the (bold/muted) header row. */
  header: string
  /** Cell + header alignment within the column. Default `'left'`. */
  align?: 'left' | 'right'
  /** Fixed column width in cells, or `'auto'` (default) to size to content. */
  width?: number | 'auto'
}

const ELLIPSIS = '…'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Display width of a string in terminal cells (grapheme + `charWidth`, min 1/cell). */
export function displayWidth(str: string): number {
  let w = 0
  for (const seg of segmenter.segment(str)) w += Math.max(charWidth(seg.segment.codePointAt(0) ?? 0), 1)
  return w
}

/** Per-column width: `'auto'` = max(header, cells) display width; fixed = clamped ≥1. */
export function computeColumnWidths(columns: TableColumn[], rows: Array<Record<string, string>>): number[] {
  return columns.map((col) => {
    if (typeof col.width === 'number') return Math.max(1, Math.trunc(col.width))
    let w = displayWidth(col.header)
    for (const row of rows) w = Math.max(w, displayWidth(row[col.key] ?? ''))
    return Math.max(1, w)
  })
}

/**
 * Fit `text` to exactly `width` cells: truncate with a trailing `…` when it
 * overflows (display-width aware), else pad the short side per `align`.
 */
export function padCell(text: string, width: number, align: 'left' | 'right'): string {
  const w = displayWidth(text)
  if (w === width) return text
  if (w > width) {
    // Drop graphemes until the kept prefix + `…` fits the column width.
    if (width <= 1) return ELLIPSIS.slice(0, width)
    let kept = ''
    let acc = 0
    for (const seg of segmenter.segment(text)) {
      const gw = Math.max(charWidth(seg.segment.codePointAt(0) ?? 0), 1)
      if (acc + gw > width - 1) break
      kept += seg.segment
      acc += gw
    }
    return kept + ELLIPSIS + ' '.repeat(Math.max(0, width - acc - 1))
  }
  const pad = ' '.repeat(width - w)
  return align === 'right' ? pad + text : text + pad
}

export const VuiTable = defineComponent({
  name: 'VuiTable',
  inheritAttrs: false,
  props: {
    columns: { type: Array as PropType<TableColumn[]>, default: () => [] },
    rows: { type: Array as PropType<Array<Record<string, string>>>, default: () => [] },
    /** Wrap the table in a rounded `<box>` border. */
    bordered: { type: Boolean, default: false },
    /** Show the header row + `─┼─` separator. `false` → bare cell grid (e.g. a key/value arg list). */
    header: { type: Boolean, default: true },
    /** Header row emphasis. Default `'bold'`. */
    headerStyle: { type: String as PropType<'bold' | 'muted'>, default: 'bold' },
  },
  setup(props, { attrs }) {
    const theme = useTheme()
    const widths = computed(() => computeColumnWidths(props.columns, props.rows))

    return () => {
      const cols = props.columns
      const w = widths.value
      const sep = () => h('span', { fg: theme.textMuted }, ' │ ')

      const lines: VNode[] = []
      if (props.header) {
        // Header row.
        const headerCells: (VNode | string)[] = []
        for (let c = 0; c < cols.length; c++) {
          if (c > 0) headerCells.push(sep())
          headerCells.push(padCell(cols[c]!.header, w[c]!, cols[c]!.align ?? 'left'))
        }
        const headerProps =
          props.headerStyle === 'muted' ? { wrap: 'nowrap', fg: theme.textMuted } : { wrap: 'nowrap', bold: true }
        // `─┼─`-style separator under the header.
        const separator = h('text', { wrap: 'nowrap', fg: theme.textMuted }, w.map((n) => '─'.repeat(n)).join('─┼─'))
        lines.push(h('text', headerProps, headerCells), separator)
      }

      if (props.rows.length === 0) {
        lines.push(h('text', { wrap: 'nowrap', fg: theme.textMuted }, '(no rows)'))
      } else {
        for (const row of props.rows) {
          const cells: (VNode | string)[] = []
          for (let c = 0; c < cols.length; c++) {
            if (c > 0) cells.push(sep())
            cells.push(padCell(row[cols[c]!.key] ?? '', w[c]!, cols[c]!.align ?? 'left'))
          }
          lines.push(h('text', { wrap: 'nowrap' }, cells))
        }
      }

      const stack = { flexDirection: 'column', alignItems: 'stretch' }
      if (props.bordered) {
        return h(
          'box',
          { border: 'rounded', borderColor: theme.border, padding: { left: 1, right: 1 }, ...stack, ...attrs },
          lines,
        )
      }
      return h('box', { ...stack, ...attrs }, lines)
    }
  },
})
