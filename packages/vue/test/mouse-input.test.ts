import { describe, expect, test } from 'bun:test'
import type { MouseEvent } from '@vui-rs/core'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { createHostFocusManager } from '../src/host/focus.ts'
import { LinkRegistry } from '../src/host/link-registry.ts'
import { type HostContext, Renderable } from '../src/host/renderable.ts'
import { createHostScheduler } from '../src/host/scheduler.ts'
import { HostSelection } from '../src/host/selection.ts'
import { defineComponent, h } from '../src/index.ts'

function mouse(partial: Partial<MouseEvent> = {}): MouseEvent {
  return {
    type: 'mouse',
    kind: 'down',
    button: 'left',
    x: 1,
    y: 1,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: '',
    ...partial,
  }
}

function context(): HostContext {
  const ctx = {
    renderer: null,
    root: null,
    overlays: [],
    theme: {} as HostContext['theme'],
    dirtyLayout: new Set<Renderable>(),
    dirtyText: new Set<Renderable>(),
    links: new LinkRegistry(),
    selection: new HostSelection(),
    layoutW: -1,
    layoutH: -1,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    afterLayout: new Set<() => void>(),
    layoutListeners: new Set<() => void>(),
    layout: null,
    paint: null,
    focusManager: null,
  } satisfies HostContext
  ctx.focusManager = createHostFocusManager(ctx)
  return ctx
}

function node(ctx: HostContext, tag: string, rect: { x0: number; y0: number; x1: number; y1: number }): Renderable {
  const n = new Renderable(ctx, 'box', tag)
  n.screenRect = rect
  return n
}

function append(parent: Renderable, child: Renderable): Renderable {
  child.parent = parent
  parent.children.push(child)
  return child
}

describe('mouse input dispatch', () => {
  test('click focuses the hit focusable node and fires onMouseDown with coords', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const child = append(root, node(ctx, 'child', { x0: 1, y0: 1, x1: 6, y1: 4 }))
    child.focusable = true
    ctx.root = root

    const seen: MouseEvent[] = []
    child.events.set('mousedown', (ev) => seen.push(ev as MouseEvent))
    ctx.focusManager!.dispatch(mouse({ x: 2, y: 2 }))

    expect(ctx.focusManager!.current()).toBe(child)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ kind: 'down', x: 2, y: 2, button: 'left' })
  })

  test('mouse events bubble to ancestors and respect preventDefault', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const child = append(root, node(ctx, 'child', { x0: 1, y0: 1, x1: 6, y1: 4 }))
    ctx.root = root
    const hits: string[] = []
    root.events.set('mousemove', () => hits.push('root'))
    child.events.set('mousemove', (ev) => {
      hits.push('child')
      ;(ev as { preventDefault: () => void }).preventDefault()
    })

    ctx.focusManager!.dispatch(mouse({ kind: 'move', button: null, x: 2, y: 2 }))
    expect(hits).toEqual(['child'])
  })

  test('pointer capture routes move/up to the capturing node off its cells', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 10, y1: 10 })
    const a = append(root, node(ctx, 'a', { x0: 0, y0: 0, x1: 1, y1: 10 })) // 1-wide track
    const b = append(root, node(ctx, 'b', { x0: 5, y0: 0, x1: 10, y1: 10 }))
    ctx.root = root
    let aMoves = 0
    let bMoves = 0
    let aUp = 0
    a.events.set('mousemove', () => aMoves++)
    a.events.set('mouseup', () => aUp++)
    b.events.set('mousemove', () => bMoves++)

    // No capture: a move over b's cells goes to b.
    ctx.focusManager!.dispatch(mouse({ kind: 'move', button: null, x: 7, y: 2 }))
    expect([aMoves, bMoves]).toEqual([0, 1])

    // Capture to a: a drag over b's cells now routes to a, not b.
    ctx.focusManager!.setPointerCapture(a)
    ctx.focusManager!.dispatch(mouse({ kind: 'drag', x: 7, y: 5 }))
    expect([aMoves, bMoves]).toEqual([1, 1])

    // `up` delivers to a and releases the capture.
    ctx.focusManager!.dispatch(mouse({ kind: 'up', x: 7, y: 8 }))
    expect(aUp).toBe(1)
    ctx.focusManager!.dispatch(mouse({ kind: 'move', button: null, x: 7, y: 2 }))
    expect([aMoves, bMoves]).toEqual([1, 2])
  })

  test('wheel dispatches to the node under the cursor', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const child = append(root, node(ctx, 'child', { x0: 1, y0: 1, x1: 6, y1: 4 }))
    ctx.root = root
    const hits: MouseEvent[] = []
    child.events.set('wheel', (ev) => hits.push(ev as MouseEvent))

    ctx.focusManager!.dispatch(mouse({ kind: 'wheel', button: 'wheelUp', x: 3, y: 2 }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'wheel', button: 'wheelUp' })
  })

  test('a click on a bordered title fires onTitleClick and does not focus or fire mousedown', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    // Right-aligned 'abc' (width 3): innerRight=19 → title cells [16,19) on row 0.
    root.focusable = true
    root.paint.border = 'rounded'
    root.paint.title = 'abc'
    root.paint.titleAlign = 'right'
    ctx.root = root

    const titleClicks: MouseEvent[] = []
    const downs: MouseEvent[] = []
    root.events.set('titleclick', (ev) => titleClicks.push(ev as MouseEvent))
    root.events.set('mousedown', (ev) => downs.push(ev as MouseEvent))

    ctx.focusManager!.dispatch(mouse({ x: 17, y: 0 }))
    expect(titleClicks).toHaveLength(1)
    expect(titleClicks[0]).toMatchObject({ kind: 'down', x: 17, y: 0 })
    expect(downs).toHaveLength(0) // title click consumes the down
    expect(ctx.focusManager!.current()).toBeNull() // and does not move focus
  })

  test('a click on the top border outside the title falls through to mousedown', () => {
    const ctx = context()
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    root.paint.border = 'rounded'
    root.paint.title = 'abc'
    root.paint.titleAlign = 'right'
    ctx.root = root

    const titleClicks: MouseEvent[] = []
    const downs: MouseEvent[] = []
    root.events.set('titleclick', (ev) => titleClicks.push(ev as MouseEvent))
    root.events.set('mousedown', (ev) => downs.push(ev as MouseEvent))

    ctx.focusManager!.dispatch(mouse({ x: 3, y: 0 })) // top border, left of the title
    expect(titleClicks).toHaveLength(0)
    expect(downs).toHaveLength(1)
  })

  test('move-triggered renders are coalesced by the host scheduler', async () => {
    const ctx = context()
    const scheduler = createHostScheduler(ctx)
    ctx.scheduleRender = scheduler.scheduleRender
    ctx.flushNow = scheduler.flushNow
    ctx.dispose = scheduler.dispose
    const root = node(ctx, 'root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const child = append(root, node(ctx, 'child', { x0: 1, y0: 1, x1: 6, y1: 4 }))
    ctx.root = root
    child.events.set('mousemove', () => ctx.scheduleRender())

    for (let i = 0; i < 10; i += 1) {
      ctx.focusManager!.dispatch(mouse({ kind: 'move', button: null, x: 2, y: 2 }))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ctx.renderCount).toBeLessThanOrEqual(1)
    scheduler.dispose()
  })
})

// End-to-end through the full input seam (`dispatchInput` → `handleSelectionMouse`
// → focus dispatch) against a real renderer, so a future change to selection
// routing can't silently swallow a title-click or start a text selection over it.
describe('title click via the full dispatchInput seam', () => {
  test('a down on the title fires titleClick and starts no text selection', () => {
    const r = new Renderer(20, 5)
    let clicks = 0
    // Full-width bordered box: innerRight=19, 'abc' right-aligned → title on [16,19), row 0.
    const App = defineComponent({
      setup: () => () =>
        h(
          'box',
          { width: { pct: 1 }, border: 'rounded', title: 'abc', titleAlign: 'right', onTitleClick: () => clicks++ },
          h('text', {}, 'hello world'),
        ),
    })
    const app = createHostApp(App).mount({ renderer: r })
    app.context.flushNow()

    app.dispatchInput(mouse({ kind: 'down', x: 17, y: 0 }))
    expect(clicks).toBe(1)
    expect(app.context.selection.active).toBe(false) // no selection started over the title

    // A down on the body text still behaves normally (no title click).
    app.dispatchInput(mouse({ kind: 'down', x: 2, y: 1 }))
    expect(clicks).toBe(1)

    app.unmount()
    r.free()
  })
})
