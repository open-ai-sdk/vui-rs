// Phase 05: first-class custom drawing. A `<canvas @draw>` paints freely but is
// CLIPPED to its laid-out rect (can't corrupt siblings); buffered canvases redraw
// only on change and blit each frame; `extend()` registers userland Renderables.
import { describe, expect, test } from 'bun:test'
import { CELL_BYTES, Renderer, rgba } from '@vui-rs/core'
import { CanvasRenderable } from '../src/host/canvas-renderable.ts'
import { createHostApp } from '../src/host/create-host-app.ts'
import { extend } from '../src/host/catalogue.ts'
import type { Renderable } from '../src/host/renderable.ts'
import { defineComponent, h, nextTick } from '../src/index.ts'

function view(r: Renderer) {
  const v = r.backBufferView()
  return new DataView(v.buffer, v.byteOffset, v.byteLength)
}
const glyphAt = (dv: DataView, w: number, x: number, y: number) => dv.getUint32((y * w + x) * CELL_BYTES, true)
const bgAt = (dv: DataView, w: number, x: number, y: number) => {
  const b = (y * w + x) * CELL_BYTES + 8
  return ((dv.getUint8(b) << 24) | (dv.getUint8(b + 1) << 16) | (dv.getUint8(b + 2) << 8) | dv.getUint8(b + 3)) >>> 0
}

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    r,
    root: app.context.root!,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

const RED = rgba(255, 0, 0)
const GREEN = rgba(0, 255, 0)

describe('<canvas @draw> (direct)', () => {
  test('draws custom cells clipped to its laid-out rect', () => {
    const { r, cleanup } = mount(20, 6, () =>
      h('box', { width: 20, height: 6 }, [
        h('canvas', {
          width: 6,
          height: 3,
          onDraw: (ctx) => {
            // Deliberately overflow: must be clamped to the 6×3 content box.
            ctx.fillRect(0, 0, 100, 100, RED)
            ctx.setCell(0, 0, 'X', { fg: rgba(255, 255, 255) })
          },
        }),
      ]),
    )
    const dv = view(r)
    expect(glyphAt(dv, 20, 0, 0)).toBe('X'.codePointAt(0)) // custom glyph drawn
    expect(bgAt(dv, 20, 5, 2)).toBe(RED) // bottom-right corner of the canvas
    // Outside the canvas rect: NOT red (overflow was clipped).
    expect(bgAt(dv, 20, 6, 0)).not.toBe(RED)
    expect(bgAt(dv, 20, 0, 3)).not.toBe(RED)
    cleanup()
  })

  test('composes with a sibling text box (z-order = tree order)', () => {
    const { r, cleanup } = mount(24, 4, () =>
      h('box', { width: 24, height: 4, flexDirection: 'row', alignItems: 'flex-start' }, [
        h('canvas', { width: 4, height: 2, onDraw: (ctx) => ctx.fillRect(0, 0, ctx.width, ctx.height, GREEN) }),
        h('text', {}, 'hi'),
      ]),
    )
    const dv = view(r)
    expect(bgAt(dv, 24, 0, 0)).toBe(GREEN) // canvas paints its cells
    expect(glyphAt(dv, 24, 4, 0)).toBe('h'.codePointAt(0)) // sibling text right after
    cleanup()
  })
})

describe('<canvas buffered>', () => {
  test('redraws onDraw only on change, but blits every frame', () => {
    const { app, r, root, cleanup } = mount(12, 4, () =>
      h('box', { width: 12, height: 4 }, [
        h('canvas', {
          buffered: true,
          width: 6,
          height: 2,
          onDraw: (ctx) => ctx.fillRect(0, 0, ctx.width, ctx.height, RED),
        }),
      ]),
    )
    const canvas = root.children[0]!.children[0]! as CanvasRenderable
    expect(canvas.drawCount).toBe(1) // drawn once on first paint
    expect(bgAt(view(r), 12, 0, 0)).toBe(RED) // blitted

    app.context.flushNow() // nothing changed
    expect(canvas.drawCount).toBe(1) // NOT redrawn
    expect(bgAt(view(r), 12, 0, 0)).toBe(RED) // still blitted

    canvas.redraw() // force a content redraw
    app.context.flushNow()
    expect(canvas.drawCount).toBe(2)
    cleanup()
  })
})

describe('extend() — userland custom Renderable', () => {
  test('registers a custom drawing element usable via h()', () => {
    class Spark extends CanvasRenderable {}
    extend({ 'x-spark': { kind: 'box', spanAttrs: 0, make: (ctx, tag) => new Spark(ctx, tag) } })
    const { r, root, cleanup } = mount(10, 3, () =>
      h('box', { width: 10, height: 3 }, [
        h('x-spark', { width: 4, height: 1, onDraw: (ctx) => ctx.fillRect(0, 0, ctx.width, 1, GREEN) }),
      ]),
    )
    const node = root.children[0]!.children[0]! as Renderable
    expect(node).toBeInstanceOf(Spark)
    expect(bgAt(view(r), 10, 0, 0)).toBe(GREEN)
    cleanup()
  })
})
