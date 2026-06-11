// Click-focus opt-out: a `clickFocus:false` focusable container holds focus for
// programmatic / `:focused` use and key dispatch, but is invisible to mouse
// click-to-focus and Tab traversal — so clicking elsewhere in an app shell never
// blurs the focused input. Default (`clickFocus` unset) keeps click-to-focus.
import { describe, expect, test } from 'bun:test'
import { type KeyEvent, type MouseEvent, Renderer } from '@vui-rs/core'
import { createApp, defineComponent, h, nextTick, ref } from '../src/index.ts'

function mouseDown(x: number, y: number): MouseEvent {
  return {
    type: 'mouse',
    kind: 'down',
    button: 'left',
    x,
    y,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: '',
  }
}
function keyEvent(name: string): KeyEvent {
  return { type: 'key', name, ctrl: false, alt: false, shift: false, meta: false, raw: name }
}

function mount(render: () => unknown, w = 40, h = 10) {
  const r = new Renderer(w, h)
  const App = defineComponent({ setup: () => render })
  const app = createApp(App).mount({ renderer: r, altScreen: false })
  return { app, cleanup: () => (app.unmount(), r.free()) }
}

describe('clickFocus opt-out', () => {
  test('clicking inside a clickFocus:false shell does not blur the focused input', async () => {
    // Shell (root) is focusable but clickFocus:false; an input is focused. A click
    // on the non-focusable message area must leave the input focused.
    const { app, cleanup } = mount(() =>
      h('box', { focusable: true, clickFocus: false, flexDirection: 'column', width: 40, height: 10 }, [
        h('box', { width: 40, height: 6 }), // message area at rows 0..5, not focusable
        h('input', { focusable: true, focused: true, width: 40, height: 1 }), // row 6
      ]),
    )
    try {
      await nextTick()
      app.context.flushNow()
      const fm = app.context.focusManager!
      const root = app.context.root!.children[0]!
      const input = root.children[1]!
      expect(fm.current()).toBe(input)

      // Click into the message area (row 2). Only ancestor focusable is the shell,
      // which opted out — so focus must stay on the input.
      fm.dispatch(mouseDown(5, 2))
      expect(fm.current()).toBe(input)
    } finally {
      cleanup()
    }
  })

  test('the shell is still programmatically / prop focusable and dispatches keys', async () => {
    const keys: string[] = []
    const shellFocused = ref(false)
    const { app, cleanup } = mount(() =>
      h(
        'box',
        {
          focusable: true,
          clickFocus: false,
          focused: shellFocused.value,
          onKeyDown: () => keys.push('shell'),
          width: 40,
          height: 4,
        },
        [h('text', {}, 'busy…')],
      ),
    )
    try {
      await nextTick()
      app.context.flushNow()
      const fm = app.context.focusManager!
      const shell = app.context.root!.children[0]!

      shellFocused.value = true // prop-driven focus still works
      await nextTick()
      app.context.flushNow()
      expect(fm.current()).toBe(shell)

      fm.dispatch(keyEvent('a')) // focused shell receives keys
      expect(keys).toEqual(['shell'])
    } finally {
      cleanup()
    }
  })

  test('Tab traversal skips a clickFocus:false node but keeps real focusables', async () => {
    const { app, cleanup } = mount(() =>
      h('box', { focusable: true, clickFocus: false }, [
        h('input', { focusable: true, width: 20, height: 1 }),
        h('input', { focusable: true, width: 20, height: 1 }),
      ]),
    )
    try {
      await nextTick()
      app.context.flushNow()
      const fm = app.context.focusManager!
      const shell = app.context.root!.children[0]!
      const a = shell.children[0]!
      const b = shell.children[1]!

      fm.focusNext()
      expect(fm.current()).toBe(a) // shell skipped, first input
      fm.focusNext()
      expect(fm.current()).toBe(b)
      fm.focusNext()
      expect(fm.current()).toBe(a) // wraps over the two inputs only
    } finally {
      cleanup()
    }
  })

  test('clicking a real focusable still moves focus (default click-to-focus intact)', async () => {
    const { app, cleanup } = mount(() =>
      h('box', { focusable: true, clickFocus: false, flexDirection: 'column' }, [
        h('input', { focusable: true, focused: true, width: 40, height: 1 }), // row 0
        h('input', { focusable: true, width: 40, height: 1 }), // row 1
      ]),
    )
    try {
      await nextTick()
      app.context.flushNow()
      const fm = app.context.focusManager!
      const root = app.context.root!.children[0]!
      const first = root.children[0]!
      const second = root.children[1]!
      expect(fm.current()).toBe(first)

      fm.dispatch(mouseDown(2, 1)) // click the second input directly
      expect(fm.current()).toBe(second)
    } finally {
      cleanup()
    }
  })
})
