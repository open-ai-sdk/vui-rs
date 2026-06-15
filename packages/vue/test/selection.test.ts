// Static-text selection: the line-flow model, the INVERSE highlight stamped over
// painted content, and the what-you-see-is-what-you-copy text gather. Mouse
// routing (down/drag/up) is thin glue over this model and exercised via the model
// directly here; the OSC 52 emit path is covered by the renderer passthrough test.
import { describe, expect, test } from 'bun:test'
import { Attr, Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { HostSelection, selectionText } from '../src/host/selection.ts'
import { defineComponent, h } from '../src/index.ts'
import { cellAttrs, cellGlyph, rowGlyphs } from './helpers/read-buffer.ts'

describe('HostSelection model', () => {
  test('active only once focus leaves the anchor; ordered normalizes direction', () => {
    const s = new HostSelection()
    expect(s.active).toBe(false)
    s.begin(3, 1, 0, 20)
    expect(s.active).toBe(false) // anchor == focus: a click, not a selection
    s.update(7, 2)
    expect(s.active).toBe(true)
    expect(s.ordered()).toEqual({ start: { x: 3, y: 1 }, end: { x: 7, y: 2 } })
    // A reverse (up-left) drag still orders top-left-first.
    s.clear()
    s.begin(7, 2, 0, 20)
    s.update(3, 1)
    expect(s.ordered()).toEqual({ start: { x: 3, y: 1 }, end: { x: 7, y: 2 } })
  })

  test('rowRange is line-flow: first row anchor→right, middle full, last left→focus', () => {
    const s = new HostSelection()
    s.begin(3, 1, 0, 20)
    s.update(7, 3)
    expect(s.rowRange(0)).toBeNull() // above
    expect(s.rowRange(1)).toEqual({ x0: 3, x1: 20 }) // first row to region right edge
    expect(s.rowRange(2)).toEqual({ x0: 0, x1: 20 }) // middle row full region
    expect(s.rowRange(3)).toEqual({ x0: 0, x1: 8 }) // last row to focus (inclusive)
    expect(s.rowRange(4)).toBeNull() // below
  })
})

describe('selection highlight + copy', () => {
  test('selected cells gain INVERSE and copy returns the rendered glyphs', () => {
    const r = new Renderer(20, 3)
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r })
    // Sanity: the text really is at row 0, starting col 0.
    expect(rowGlyphs(r, 0).startsWith('hello world')).toBe(true)

    // Drag-select the first word "hello" (cols 0..4).
    app.context.selection.begin(0, 0, 0, 20)
    app.context.selection.update(4, 0)
    app.context.flushNow() // repaint → paintSelection stamps INVERSE

    expect(cellAttrs(r, 0, 0) & Attr.INVERSE).toBeTruthy()
    expect(cellAttrs(r, 4, 0) & Attr.INVERSE).toBeTruthy()
    expect(cellAttrs(r, 6, 0) & Attr.INVERSE).toBeFalsy() // 'w' is outside
    expect(selectionText(r, app.context.selection)).toBe('hello')

    app.unmount()
    r.free()
  })

  test('a selected wide glyph keeps its glyph (INVERSE on leader + continuation)', () => {
    const r = new Renderer(20, 1)
    const App = defineComponent({ setup: () => () => h('text', {}, '世界x') })
    const app = createHostApp(App).mount({ renderer: r })
    expect(cellGlyph(r, 0, 0)).toBe('世') // wide leader at col 0 (cols 0-1)

    // Select across the wide glyphs (cols 0..3).
    app.context.selection.begin(0, 0, 0, 20)
    app.context.selection.update(3, 0)
    app.context.flushNow()

    // The wide glyph must survive the highlight (regression: it used to blank out
    // because re-stamping defused its continuation cell).
    expect(cellGlyph(r, 0, 0)).toBe('世')
    expect(cellAttrs(r, 0, 0) & Attr.INVERSE).toBeTruthy() // leader inverted
    expect(cellAttrs(r, 1, 0) & Attr.INVERSE).toBeTruthy() // continuation inverted too
    expect(selectionText(r, app.context.selection)).toBe('世界') // cols 0-3, not the col-4 'x'

    app.unmount()
    r.free()
  })

  test('copy keeps captured scroll rows when no selected row is currently visible', () => {
    const r = new Renderer(10, 2)
    const App = defineComponent({ setup: () => () => h('text', {}, 'alpha') })
    const app = createHostApp(App).mount({ renderer: r })

    app.context.selection.begin(0, 0, 0, 10)
    app.context.selection.update(4, 0)
    app.context.selection.captureScroll(r, 1, { y0: 0, y1: 2 }, { x: 4, y: -1 })

    expect(app.context.selection.visibleRows(r)).toBeNull()
    expect(selectionText(r, app.context.selection)).toBe('alpha')

    app.unmount()
    r.free()
  })
})
