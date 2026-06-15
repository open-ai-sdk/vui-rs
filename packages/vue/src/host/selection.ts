// Host-level text selection over static `<text>`/`<markdown>` content. The model
// is a pair of screen-cell points (anchor where the drag began, focus where it is
// now) plus the horizontal bounds of the text region the selection flows within,
// so it reads like a normal editor selection (line-flow), not a rectangle: the
// first row runs from the anchor to the region's right edge, full middle rows, and
// the last row from the region's left edge to the focus. Copy reads the rendered
// glyphs straight from the back buffer (what-you-see-is-what-you-copy), which
// handles wrapped markdown without a semantic glyph map.

import { Attr, CELL_BYTES, type Renderer } from '@vui-rs/core'
import type { Clip } from './renderable.ts'

export interface SelPoint {
  x: number
  y: number
}

export class HostSelection {
  anchor: SelPoint | null = null
  focus: SelPoint | null = null
  /** Left/right screen columns (half-open) of the anchored text region. */
  left = 0
  right = 0
  #before: string[] = []
  #after: string[] = []

  /** True once the drag covers more than the single anchor cell. */
  get active(): boolean {
    return (
      this.anchor !== null && this.focus !== null && !(this.anchor.x === this.focus.x && this.anchor.y === this.focus.y)
    )
  }

  begin(x: number, y: number, left: number, right: number): void {
    this.anchor = { x, y }
    this.focus = { x, y }
    this.left = left
    this.right = right
    this.#before = []
    this.#after = []
  }

  update(x: number, y: number): void {
    if (this.anchor) this.focus = { x, y }
  }

  clear(): void {
    this.anchor = null
    this.focus = null
    this.#before = []
    this.#after = []
  }

  /** Anchor/focus ordered top-left-first, or null when no selection exists. */
  ordered(): { start: SelPoint; end: SelPoint } | null {
    if (!this.anchor || !this.focus) return null
    const a = this.anchor
    const b = this.focus
    const aFirst = a.y < b.y || (a.y === b.y && a.x <= b.x)
    return aFirst ? { start: a, end: b } : { start: b, end: a }
  }

  /**
   * The half-open `[x0, x1)` column span selected on row `y` (line-flow), clamped
   * to the region bounds; null when the row is outside the selection.
   */
  rowRange(y: number): { x0: number; x1: number } | null {
    const o = this.ordered()
    if (!o) return null
    if (y < o.start.y || y > o.end.y) return null
    const x0 = y === o.start.y ? o.start.x : this.left
    const x1 = y === o.end.y ? o.end.x + 1 : this.right // include the end cell
    return { x0: Math.max(x0, this.left), x1: Math.min(x1, this.right) }
  }

  /**
   * Preserve selected rows that are about to leave a scroll viewport during an
   * active drag. Selection coordinates are screen-relative, but copy needs the
   * full swept transcript, including rows no longer visible when mouse-up lands.
   */
  captureScroll(renderer: Renderer, deltaY: number, viewport: Pick<Clip, 'y0' | 'y1'>): void {
    if (!this.active || deltaY === 0 || viewport.y0 >= viewport.y1) return
    const rows: string[] = []
    const n = Math.min(Math.abs(Math.trunc(deltaY)), Math.max(0, viewport.y1 - viewport.y0))
    if (n === 0) return
    if (deltaY > 0) {
      for (let y = viewport.y0; y < viewport.y0 + n; y++) {
        const text = selectedRowText(renderer, this, y)
        if (text !== null) rows.push(text)
      }
      if (rows.length) this.#before.push(...rows)
    } else {
      for (let y = viewport.y1 - n; y < viewport.y1; y++) {
        const text = selectedRowText(renderer, this, y)
        if (text !== null) rows.push(text)
      }
      if (rows.length) this.#after.unshift(...rows)
    }
  }

  capturedBefore(): readonly string[] {
    return this.#before
  }

  capturedAfter(): readonly string[] {
    return this.#after
  }
}

/**
 * Highlight the selection by OR-ing the INVERSE attribute into each selected
 * cell's attrs, written straight into the back buffer (after the paint walk, before
 * flush). We mutate ONLY the attrs byte — never `ch` — so we don't trip the draw
 * prims' wide-glyph defuse logic, which would blank a selected CJK/emoji leader by
 * clearing its continuation cell. Setting an attr bit preserves the wide-glyph
 * pairing the renderer requires (both leader and its continuation get INVERSE).
 */
export function paintSelection(renderer: Renderer, sel: HostSelection): void {
  const o = sel.ordered()
  if (!o || !sel.active) return
  const view = renderer.backBufferView()
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength)
  for (let y = o.start.y; y <= o.end.y; y++) {
    const range = sel.rowRange(y)
    if (!range || y < 0 || y >= renderer.height) continue
    for (let x = range.x0; x < range.x1; x++) {
      if (x < 0 || x >= renderer.width) continue
      const off = (y * renderer.width + x) * CELL_BYTES + 12 // attrs u16 offset
      dv.setUint16(off, (dv.getUint16(off, true) | Attr.INVERSE) & 0xffff, true)
    }
  }
}

/**
 * The selected text gathered from the rendered glyphs (what-you-see-is-what-you-
 * copy): one string per row, trailing whitespace trimmed, rows joined by newline.
 * Wide-glyph continuation cells are skipped so a CJK char isn't duplicated.
 */
export function selectionText(renderer: Renderer, sel: HostSelection): string {
  const o = sel.ordered()
  if (!o || !sel.active) return ''
  const before = sel.capturedBefore()
  const after = sel.capturedAfter()
  const view = renderer.backBufferView()
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength)
  const lines: string[] = [...before]
  for (let y = o.start.y; y <= o.end.y; y++) {
    lines.push(selectedRowTextFromView(renderer, sel, y, dv) ?? '')
  }
  lines.push(...after)
  return lines.join('\n')
}

function selectedRowText(renderer: Renderer, sel: HostSelection, y: number): string | null {
  const view = renderer.backBufferView()
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength)
  return selectedRowTextFromView(renderer, sel, y, dv)
}

function selectedRowTextFromView(renderer: Renderer, sel: HostSelection, y: number, dv: DataView): string | null {
  const range = sel.rowRange(y)
  if (!range || y < 0 || y >= renderer.height) return null
  let line = ''
  for (let x = range.x0; x < range.x1; x++) {
    if (x < 0 || x >= renderer.width) continue
    const base = (y * renderer.width + x) * CELL_BYTES
    const attrs = dv.getUint16(base + 12, true)
    if (attrs & Attr.WIDE_CONTINUATION) continue
    const ch = dv.getUint32(base, true)
    if (ch !== 0) line += String.fromCodePoint(ch)
  }
  return line.replace(/\s+$/u, '')
}
