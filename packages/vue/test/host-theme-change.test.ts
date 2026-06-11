// The `onThemeChange` mount hook: a decoded ThemeEvent (DEC mode 2031) routed
// through `handleInputEvent` reaches the app's callback, and the callback can swap
// the live theme via `setTheme()`. Driven offscreen through `dispatchInput`, the
// same seam the terminal session's keyboard pump funnels input through — so no real
// tty is needed. Without the option, a ThemeEvent is an inert no-op (no throw).
import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createApp, defineComponent, h, lightTheme } from '../src/index.ts'

const App = defineComponent({
  setup: () => () => h('text', { width: 1, height: 1 }, 'A'),
})

describe('onThemeChange host hook', () => {
  test('a ThemeEvent fires the callback with the reported mode', () => {
    const seen: Array<'dark' | 'light'> = []
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({
      renderer: r,
      altScreen: false,
      onThemeChange: (mode) => seen.push(mode),
    })

    app.dispatchInput({ type: 'theme', mode: 'light', raw: '' })
    app.dispatchInput({ type: 'theme', mode: 'dark', raw: '' })
    expect(seen).toEqual(['light', 'dark'])

    app.unmount()
    r.free()
  })

  test('without the option a ThemeEvent is an inert no-op', () => {
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({ renderer: r, altScreen: false })

    expect(() => app.dispatchInput({ type: 'theme', mode: 'light', raw: '' })).not.toThrow()

    app.unmount()
    r.free()
  })

  test('the callback can swap the live theme via setTheme', () => {
    const r = new Renderer(10, 3)
    const app = createApp(App).mount({
      renderer: r,
      altScreen: false,
      onThemeChange: (mode) => {
        if (mode === 'light') app.setTheme(lightTheme)
      },
    })

    app.dispatchInput({ type: 'theme', mode: 'light', raw: '' })
    app.context.flushNow()
    expect(app.context.theme.bg).toBe(lightTheme.bg)

    app.unmount()
    r.free()
  })
})
