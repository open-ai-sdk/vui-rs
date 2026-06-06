// Extensibility tests: `extend()` registers a custom element tag that renders as
// an existing kind with no core change, and a custom component (`VuiSpinner`)
// built from the built-ins animates and themes itself. Together these cover the
// two extension paths: custom tags (extend) and custom components (composition).
import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { VuiSpinner, createApp, darkTheme, defineComponent, extend, h, nextTick } from '../src/index.ts'
import { allGlyphs, channels, firstGlyph, firstGlyphFg } from './helpers/read-buffer.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('extend()', () => {
  test('registers a custom tag that renders as its mapped kind', () => {
    extend({ 'x-panel': { kind: 'box', spanAttrs: 0 } })
    const App = defineComponent({
      setup: () => () => h('x-panel', { border: true, width: 8, height: 3 }, h('text', { width: 4, height: 1 }, 'ok')),
    })
    const r = new Renderer(12, 4)
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    const screen = allGlyphs(r)
    expect(screen).toContain('ok') // the custom box laid out + painted its child
    expect(screen).toContain('┌') // ...and drew its border
    app.unmount()
    r.free()
  })

  test('an unknown tag is a hard error until registered', () => {
    const App = defineComponent({ setup: () => () => h('totally-unknown', {}, 'x') })
    const r = new Renderer(8, 3)
    expect(() => createApp(App).mount({ renderer: r, altScreen: false })).toThrow(/unknown element/)
    r.free()
  })
})

describe('VuiSpinner', () => {
  test('animates through its frames on the interval', async () => {
    const App = defineComponent({
      setup: () => () => h(VuiSpinner, { interval: 10, frames: ['A', 'B', 'C'] }),
    })
    const r = new Renderer(6, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })

    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      await sleep(12)
      await nextTick()
      app.context.flushNow()
      const g = firstGlyph(r)
      if (g) seen.add(g)
    }
    expect(seen.size).toBeGreaterThan(1) // the frame advanced over time
    for (const g of seen) expect(['A', 'B', 'C']).toContain(g)
    app.unmount()
    r.free()
  })

  test('defaults its color to the theme accent', () => {
    const App = defineComponent({ setup: () => () => h(VuiSpinner, { frames: ['A'] }) })
    const r = new Renderer(6, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    expect(firstGlyphFg(r)).toEqual(channels(darkTheme.accent))
    app.unmount()
    r.free()
  })

  test('stops its timer on unmount (no further frames painted)', async () => {
    const App = defineComponent({
      setup: () => () => h(VuiSpinner, { interval: 5, frames: ['A', 'B'] }),
    })
    const r = new Renderer(6, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    app.unmount()
    const before = app.context.renderCount
    await sleep(30) // several intervals — a leaked timer would keep scheduling
    expect(app.context.renderCount).toBe(before)
    r.free()
  })
})
