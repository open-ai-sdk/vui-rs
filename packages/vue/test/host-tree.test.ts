// Phase 01 (JS host foundation): mount a Vue app under the JS-host node-ops and
// assert the resulting Renderable graph — structure (insert/remove/reorder),
// v-for/v-if anchors, and prop routing (layout vs paint vs span vs event buckets).
// No paint yet: the host app builds the tree only (layout/paint hooks unwired).
import { describe, expect, test } from 'bun:test'
import { Attr } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import type { Renderable } from '../src/host/renderable.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'

function mount(render: () => unknown) {
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ altScreen: false })
  return { app, root: app.context.root!, cleanup: () => app.unmount() }
}

/** Child kinds of a node, for compact structural assertions. */
function kinds(node: Renderable): string[] {
  return node.children.map((c) => c.kind)
}

/**
 * Rendered string of a `<text>`: Vue routes a single string child through
 * `setElementText` (→ `directText`); mixed/interpolated children become
 * `raw-text`/`span` nodes whose `text` concatenates.
 */
function textValue(node: Renderable): string {
  if (node.directText !== null) return node.directText
  return node.children.map((c) => c.text).join('')
}

describe('JS host node-ops', () => {
  test('builds a Renderable tree from h() (box > text > raw-text)', () => {
    const { root, cleanup } = mount(() => h('box', { border: true }, [h('text', {}, 'hello')]))
    expect(kinds(root)).toEqual(['box'])
    const box = root.children[0]!
    expect(box.kind).toBe('box')
    expect(box.tag).toBe('box')
    const text = box.children[0]!
    expect(text.kind).toBe('text')
    expect(textValue(text)).toBe('hello')
    cleanup()
  })

  test('layout props route to style, paint props to paint', () => {
    const { root, cleanup } = mount(() => h('box', { width: 10, height: 4, padding: 1, bg: 0x112233ff, border: true }))
    const box = root.children[0]!
    expect(box.style.width).toBe(10)
    expect(box.style.height).toBe(4)
    expect(box.style.padding).toBe(1)
    // a border reserves one layout cell per side
    expect((box.style as Record<string, unknown>).border).toBe(1)
    expect(box.paint.bg).toBe(0x112233ff)
    expect(box.paint.border).toBe('single')
    cleanup()
  })

  test('inset sides fold into style.inset; borderWidth maps to style.border', () => {
    const { root, cleanup } = mount(() => h('box', { position: 'absolute', top: 2, left: 3, borderWidth: 1 }))
    const box = root.children[0]!
    expect(box.style.position).toBe('absolute')
    expect(box.style.inset).toEqual({ top: 2, left: 3 })
    expect((box.style as Record<string, unknown>).border).toBe(1)
    cleanup()
  })

  test('span attrs fold (bold tag + explicit italic) and events store, not paint', () => {
    const onKeyDown = () => {}
    const { root, cleanup } = mount(() => h('text', {}, [h('b', { italic: true, onKeyDown }, 'x')]))
    const text = root.children[0]!
    const span = text.children[0]!
    expect(span.kind).toBe('span')
    expect(span.spanStyle.attrs & Attr.BOLD).toBe(Attr.BOLD)
    expect(span.spanStyle.attrs & Attr.ITALIC).toBe(Attr.ITALIC)
    expect(span.events.get('keydown')).toBe(onKeyDown)
    text.ctx.dirtyText.has(text) // enclosing text marked dirty by the span
    cleanup()
  })

  test('on: event form (camelCase arg on a custom element) registers a handler', () => {
    // The Vue template compiler emits `@keyDown` on a custom element as the prop
    // key `on:keyDown`; it must route to the same "keydown" handler as `onKeyDown`.
    const handler = () => {}
    const { root, cleanup } = mount(() => h('box', { 'on:keyDown': handler, 'on:mouseDown': handler }))
    const box = root.children[0]!
    expect(box.events.get('keydown')).toBe(handler)
    expect(box.events.get('mousedown')).toBe(handler)
    cleanup()
  })

  test('v-if toggles a child in and out (anchor parity)', async () => {
    const show = ref(true)
    const { root, cleanup } = mount(() => h('box', {}, [show.value ? h('text', {}, 'on') : null]))
    const box = root.children[0]!
    expect(box.children.some((c) => c.kind === 'text')).toBe(true)
    show.value = false
    await nextTick()
    expect(box.children.some((c) => c.kind === 'text')).toBe(false)
    show.value = true
    await nextTick()
    expect(box.children.some((c) => c.kind === 'text')).toBe(true)
    cleanup()
  })

  test('v-for renders, reorders, and removes keeping child order', async () => {
    const items = ref(['a', 'b', 'c'])
    const { root, cleanup } = mount(() =>
      h(
        'box',
        {},
        items.value.map((it) => h('text', { key: it }, it)),
      ),
    )
    const box = root.children[0]!
    const texts = () => box.children.filter((c) => c.kind === 'text').map(textValue)
    expect(texts()).toEqual(['a', 'b', 'c'])
    items.value = ['c', 'a', 'b']
    await nextTick()
    expect(texts()).toEqual(['c', 'a', 'b'])
    items.value = ['c', 'b']
    await nextTick()
    expect(texts()).toEqual(['c', 'b'])
    cleanup()
  })

  test('nesting a box inside a text is a hard error', () => {
    expect(() => mount(() => h('text', {}, [h('box', {})]))).toThrow(/cannot nest/)
  })

  test('a full render pass (layout + paint) runs once on mount', () => {
    const { app, cleanup } = mount(() => h('box', {}, [h('text', {}, 'x')]))
    expect(app.context.layout).not.toBeNull() // layout (Phase 03)
    expect(app.context.paint).not.toBeNull() // paint (Phase 04)
    expect(app.context.renderer).not.toBeNull()
    expect(app.context.renderCount).toBe(1)
    cleanup()
  })

  test('on-demand: an idle app emits zero renders between changes', async () => {
    const count = ref(0)
    const { app, cleanup } = mount(() => h('box', {}, [h('text', {}, String(count.value))]))
    const after = app.context.renderCount // one render on mount
    // No state change across several ticks → no scheduled renders.
    await nextTick()
    await nextTick()
    expect(app.context.renderCount).toBe(after)
    // A change schedules exactly one more (coalesced) render.
    count.value++
    await nextTick()
    app.context.flushNow()
    expect(app.context.renderCount).toBeGreaterThan(after)
    cleanup()
  })
})
