// Element screen-rect measurement: `getScreenRect` accumulates absolute coords up
// the parent chain (minus each ancestor's scroll, stopping at a hoisted overlay),
// and `useElementRect` exposes it reactively off the layout tick. The walk runs on
// hand-built Renderable trees; the composable runs through the real host app so
// layout actually fires the tick.
import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createApp, defineComponent, h, nextTick, ref } from '../src/index.ts'
import { useElementRect } from '../src/use-element-rect.ts'
import { getScreenRect } from '../src/host/measure.ts'
import { type HostContext, type LayoutRect, Renderable } from '../src/host/renderable.ts'

const noEdges = { left: 0, right: 0, top: 0, bottom: 0 }
function rect(x: number, y: number, w: number, h: number): LayoutRect {
  return { x, y, w, h, padding: noEdges, border: noEdges }
}

const fakeCtx = {} as HostContext
function node(r: LayoutRect | null, parent: Renderable | null = null): Renderable {
  const n = new Renderable(fakeCtx, 'box', 'box')
  n.rect = r
  if (parent) {
    n.parent = parent
    parent.children.push(n)
  }
  return n
}

describe('getScreenRect', () => {
  test('nested boxes accumulate parent-relative origins', () => {
    const root = node(rect(0, 0, 40, 20))
    const mid = node(rect(2, 3, 30, 14), root)
    const leaf = node(rect(1, 1, 10, 4), mid)
    expect(getScreenRect(leaf)).toEqual({ x: 3, y: 4, width: 10, height: 4 })
  })

  test('a scrolled ancestor shifts descendants by its scroll offset', () => {
    const root = node(rect(0, 0, 40, 20))
    const viewport = node(rect(0, 2, 40, 10), root)
    viewport.scrollY = 5 // children paint 5 rows up
    const item = node(rect(0, 8, 40, 1), viewport)
    // 8 (item.y) + 2 (viewport.y) - 5 (viewport.scrollY) = 5
    expect(getScreenRect(item)).toEqual({ x: 0, y: 5, width: 40, height: 1 })
  })

  test('an element inside an overlay anchors to the overlay origin, not the flow parent', () => {
    const root = node(rect(0, 0, 40, 20))
    const flowParent = node(rect(10, 10, 20, 5), root)
    // Overlay declared under flowParent but hoisted: its rect origin is absolute.
    const overlay = node(rect(4, 1, 12, 6), flowParent)
    overlay.isOverlay = true
    const inner = node(rect(2, 2, 8, 1), overlay)
    // x = 2 + 4, y = 2 + 1 — flowParent's (10,10) is NOT included (walk stops at the overlay).
    expect(getScreenRect(inner)).toEqual({ x: 6, y: 3, width: 8, height: 1 })
  })

  test('returns null before the node is laid out', () => {
    expect(getScreenRect(node(null))).toBeNull()
  })

  test('rounds each edge away from zero, matching the paint walk', () => {
    const root = node(rect(0, 0, 40, 20))
    const leaf = node(rect(1.5, 2.5, 3, 4), root)
    // round(1.5)=2, round(2.5)=3; width = round(4.5)-2 = 3, height = round(6.5)-3 = 4
    expect(getScreenRect(leaf)).toEqual({ x: 2, y: 3, width: 3, height: 4 })
  })
})

describe('useElementRect', () => {
  test('reports the element rect after layout and updates when it moves', async () => {
    const pad = ref(0)
    let measured!: ReturnType<typeof useElementRect>
    const App = defineComponent({
      setup() {
        const anchorRef = ref<unknown>(null)
        measured = useElementRect(anchorRef)
        return () =>
          h('box', { flexDirection: 'column' }, [
            h('box', { height: pad.value }),
            h('box', { ref: anchorRef, height: 3, width: 12 }),
          ])
      },
    })
    const r = new Renderer(40, 10)
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    try {
      await nextTick()
      app.context.flushNow()
      // First box has height 0, so the anchor sits at the top.
      expect(measured.value).toEqual({ x: 0, y: 0, width: 12, height: 3 })

      pad.value = 4 // push the anchor down 4 rows
      await nextTick()
      app.context.flushNow()
      expect(measured.value?.y).toBe(4)
    } finally {
      app.unmount()
      r.free()
    }
  })
})
