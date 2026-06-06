import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { VuiScrollBar } from '../src/host/components/scroll-bar.ts'
import { VuiScrollBox } from '../src/host/components/scroll-box.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'
import { allGlyphs, cellGlyph } from './helpers/read-buffer.ts'

function flush(app: { context: { flushNow: () => void } }): void {
  app.context.flushNow()
}

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    renderer: r,
    root: app.context.root!,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('scroll-box', () => {
  test('scrollY shifts children inside the existing content clip', async () => {
    const y = ref(1)
    const { app, renderer, cleanup } = mount(10, 4, () =>
      h(VuiScrollBox, { width: 4, height: 2, modelValue: y.value }, () => [
        h('text', {}, 'A'),
        h('text', {}, 'B'),
        h('text', {}, 'C'),
      ]),
    )
    await nextTick()
    app.context.flushNow()

    expect(cellGlyph(renderer, 0, 0)).toBe('B')
    expect(cellGlyph(renderer, 0, 1)).toBe('C')
    expect(allGlyphs(renderer)).not.toContain('A')
    cleanup()
  })

  test('wheel and keyboard scrolling clamp at content bounds', async () => {
    let seen = 0
    const { app, renderer, cleanup } = mount(10, 5, () =>
      h(
        VuiScrollBox,
        {
          width: 4,
          height: 2,
          focused: true,
          onScroll: (value: number) => {
            seen = value
          },
        },
        () => [h('text', {}, 'A'), h('text', {}, 'B'), h('text', {}, 'C')],
      ),
    )
    await nextTick()
    app.context.flushNow()

    app.context.focusManager!.dispatch({
      type: 'key',
      name: 'pageDown',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: '',
    })
    app.context.flushNow()
    expect(seen).toBe(1)
    expect(cellGlyph(renderer, 0, 0)).toBe('B')

    app.context.focusManager!.dispatch({
      type: 'mouse',
      kind: 'wheel',
      button: 'wheelUp',
      x: 0,
      y: 0,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: '',
    })
    app.context.flushNow()
    expect(seen).toBe(0)
    expect(cellGlyph(renderer, 0, 0)).toBe('A')
    cleanup()
  })

  test('nested scrollboxes compose clips and offsets', async () => {
    const { app, renderer, cleanup } = mount(10, 4, () =>
      h(VuiScrollBox, { width: 4, height: 2, modelValue: 1 }, () => [
        h('text', {}, 'X'),
        h(VuiScrollBox, { width: 4, height: 2, modelValue: 1 }, () => [
          h('text', {}, 'A'),
          h('text', {}, 'B'),
          h('text', {}, 'C'),
        ]),
      ]),
    )
    await nextTick()
    app.context.flushNow()

    expect(allGlyphs(renderer)).toBe('BC')
    cleanup()
  })
})

describe('scroll-box key + scrollbar plumbing', () => {
  test("forwards non-scroll keys to the consumer's @keyDown, swallows scroll keys", async () => {
    const seen: string[] = []
    const { app, cleanup } = mount(10, 5, () =>
      h(
        VuiScrollBox,
        {
          width: 4,
          height: 2,
          focused: true,
          onKeyDown: (ev: { name: string }) => seen.push(ev.name),
        },
        () => [h('text', {}, 'A'), h('text', {}, 'B'), h('text', {}, 'C')],
      ),
    )
    await nextTick()
    flush(app)

    const key = (name: string) => ({
      type: 'key' as const,
      name,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: '',
    })
    // "a" isn't a scroll key → forwarded to the consumer.
    app.context.focusManager!.dispatch(key('a'))
    // pageDown is consumed by the scroll-box → NOT forwarded.
    app.context.focusManager!.dispatch(key('pageDown'))
    expect(seen).toEqual(['a'])
    cleanup()
  })

  test('integrated scrollbar renders a track + proportional thumb', async () => {
    const { app, root, cleanup } = mount(12, 6, () =>
      h(VuiScrollBox, { width: 8, height: 4, scrollbar: true, focused: true }, () =>
        Array.from({ length: 8 }, (_, i) => h('text', { key: i }, `row ${i}`)),
      ),
    )
    await nextTick()
    flush(app) // layout populates rects; afterLayout publishes geometry to `view`
    await nextTick() // Vue re-renders the scroll-box → bar receives the geometry
    flush(app)

    const row = root.children[0]! // outer wrapper row
    const track = row.children[1]! // VuiScrollBar's track box
    const thumb = track.children[0]!
    expect(Math.round(track.rect!.w)).toBe(1)
    expect(Math.round(track.rect!.h)).toBe(4) // viewport height
    // 8 rows of content in a 4-row viewport → thumb is ~half the track.
    expect(Math.round(thumb.rect!.h)).toBe(2)
    cleanup()
  })
})

describe('overflow', () => {
  test('visible lets children spill past the content box; hidden clips them', async () => {
    function run(overflow: 'visible' | 'hidden') {
      // A height-1 box holding three 1-row texts: content box is one row, so rows
      // 2 and 3 fall outside it. `visible` paints them anyway (bounded only by the
      // screen); `hidden` crops to the content box.
      const ctx = mount(6, 4, () =>
        h('box', { width: 4, height: 1, overflow, flexDirection: 'column' }, [
          h('text', {}, 'A'),
          h('text', {}, 'B'),
          h('text', {}, 'C'),
        ]),
      )
      return ctx
    }

    const vis = run('visible')
    await nextTick()
    flush(vis.app)
    expect(allGlyphs(vis.renderer)).toContain('B')
    expect(allGlyphs(vis.renderer)).toContain('C')
    vis.cleanup()

    const hid = run('hidden')
    await nextTick()
    flush(hid.app)
    expect(cellGlyph(hid.renderer, 0, 0)).toBe('A')
    expect(allGlyphs(hid.renderer)).not.toContain('B')
    expect(allGlyphs(hid.renderer)).not.toContain('C')
    hid.cleanup()
  })

  test('culling nulls the screenRect of fully off-screen children', async () => {
    const { app, root, cleanup } = mount(6, 6, () =>
      h('box', { width: 4, height: 2, overflow: 'scroll', flexDirection: 'column' }, [
        h('text', {}, 'A'),
        h('text', {}, 'B'),
        h('text', {}, 'C'),
        h('text', {}, 'D'),
        h('text', {}, 'E'),
      ]),
    )
    await nextTick()
    flush(app)

    const box = root.children[0]!
    const [a, b, c, d, e] = box.children
    // Viewport is rows [0,2): A and B paint, C/D/E are culled (skipped subtrees).
    expect(a!.screenRect).not.toBeNull()
    expect(b!.screenRect).not.toBeNull()
    expect(c!.screenRect).toBeNull()
    expect(d!.screenRect).toBeNull()
    expect(e!.screenRect).toBeNull()
    cleanup()
  })
})

describe('stick-to-bottom', () => {
  test('pins to the bottom as content grows, unless scrolled up', async () => {
    const items = ref(['A', 'B', 'C'])
    const { app, renderer, cleanup } = mount(6, 5, () =>
      h(VuiScrollBox, { width: 4, height: 2, stickToBottom: true, focused: true }, () =>
        items.value.map((t) => h('text', { key: t }, t)),
      ),
    )
    await nextTick()
    flush(app)
    // 3 rows, viewport 2 → pinned to bottom shows the last two.
    expect(allGlyphs(renderer)).toBe('BC')

    items.value = ['A', 'B', 'C', 'D', 'E']
    await nextTick()
    flush(app)
    // Still stuck → follows the new bottom.
    expect(allGlyphs(renderer)).toBe('DE')

    // Scroll up off the bottom → unstick; new content no longer yanks the view.
    app.context.focusManager!.dispatch({
      type: 'mouse',
      kind: 'wheel',
      button: 'wheelUp',
      x: 0,
      y: 0,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: '',
    })
    flush(app)
    const afterScrollUp = allGlyphs(renderer)
    items.value = ['A', 'B', 'C', 'D', 'E', 'F']
    await nextTick()
    flush(app)
    expect(allGlyphs(renderer)).toBe(afterScrollUp)
    expect(allGlyphs(renderer)).not.toBe('EF')
    cleanup()
  })
})

describe('scroll-bar', () => {
  test('thumb size and top track the scroll ratio', async () => {
    const scrollY = ref(5)
    const { app, root, cleanup } = mount(4, 12, () =>
      h(VuiScrollBar, {
        scrollY: scrollY.value,
        viewportHeight: 4,
        contentHeight: 8,
      }),
    )
    await nextTick()
    app.context.flushNow()

    const track = root.children[0]!
    const thumb = track.children[0]!
    expect(Math.round(thumb.rect!.h)).toBe(2)
    expect(Math.round(thumb.rect!.y)).toBe(2)
    cleanup()
  })
})
