// Focus model: Tab traversal walks focusable nodes in DFS order and wraps; a
// key event dispatches to the focused node then bubbles to ancestors, stopping
// when a handler calls preventDefault. Runs offscreen (injected renderer).
import { describe, expect, test } from 'bun:test'
import { Renderer, type KeyEvent } from '@vui-rs/core'
import { createApp, defineComponent, h, ref, nextTick } from '../src/index.ts'
import { VuiHostTextarea } from '../src/host/components/textarea.ts'
import type { DispatchableEvent } from '../src/focus.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function keyEvent(name: string): KeyEvent {
  return {
    type: 'key',
    name,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: name,
  }
}

function mount(render: () => unknown) {
  const r = new Renderer(40, 6)
  const App = defineComponent({ setup: () => render })
  const app = createApp(App).mount({ renderer: r, altScreen: false })
  return {
    app,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('focus manager', () => {
  test('Tab traversal cycles focusable nodes in DFS order', () => {
    const { app, cleanup } = mount(() =>
      h('box', null, [
        h('input', { focusable: true }),
        h('box', null, [h('input', { focusable: true })]),
        h('input', { focusable: true }),
      ]),
    )
    try {
      const fm = app.context.focusManager!
      const box = app.context.root!.children[0]!
      const first = box.children[0]!
      const nested = box.children[1]!.children[0]!
      const third = box.children[2]!

      fm.focusNext()
      expect(fm.current()).toBe(first)
      fm.focusNext()
      expect(fm.current()).toBe(nested) // DFS descends into the nested box
      fm.focusNext()
      expect(fm.current()).toBe(third)
      fm.focusNext()
      expect(fm.current()).toBe(first) // wraps
      fm.focusPrev()
      expect(fm.current()).toBe(third) // wraps backwards
    } finally {
      cleanup()
    }
  })

  test('a key bubbles from the focused node to its ancestors', () => {
    const log: string[] = []
    const { app, cleanup } = mount(() =>
      h('box', { onKeyDown: () => log.push('box') }, [
        h('input', { focusable: true, onKeyDown: () => log.push('input') }),
      ]),
    )
    try {
      const fm = app.context.focusManager!
      fm.focusNext()
      fm.dispatch(keyEvent('a'))
      expect(log).toEqual(['input', 'box'])
    } finally {
      cleanup()
    }
  })

  test('preventDefault stops the bubble', () => {
    const log: string[] = []
    const { app, cleanup } = mount(() =>
      h('box', { onKeyDown: () => log.push('box') }, [
        h('input', {
          focusable: true,
          onKeyDown: (e: DispatchableEvent) => {
            log.push('input')
            e.preventDefault()
          },
        }),
      ]),
    )
    try {
      const fm = app.context.focusManager!
      fm.focusNext()
      fm.dispatch(keyEvent('a'))
      expect(log).toEqual(['input']) // box handler not reached
    } finally {
      cleanup()
    }
  })

  test('focus/blur fire on the involved nodes', async () => {
    const events: string[] = []
    const { app, cleanup } = mount(() =>
      h('box', null, [
        h('input', {
          focusable: true,
          onFocus: () => events.push('focus-a'),
          onBlur: () => events.push('blur-a'),
        }),
        h('input', { focusable: true, onFocus: () => events.push('focus-b') }),
      ]),
    )
    try {
      await sleep(10)
      const fm = app.context.focusManager!
      fm.focusNext() // -> a
      fm.focusNext() // -> b (blurs a)
      expect(events).toEqual(['focus-a', 'blur-a', 'focus-b'])
    } finally {
      cleanup()
    }
  })

  test('textarea indent mode can receive Tab instead of moving focus', async () => {
    const value = ref('')
    const { app, cleanup } = mount(() =>
      h('box', null, [
        h(VuiHostTextarea, {
          value: value.value,
          focused: true,
          tabBehavior: 'indent',
          tabSize: 2,
          'onUpdate:value': (v: string) => (value.value = v),
        }),
        h('input', { focusable: true }),
      ]),
    )
    try {
      await nextTick()
      const fm = app.context.focusManager!
      const textarea = app.context.root!.children[0]!.children[0]!
      expect(fm.current()).toBe(textarea)
      fm.dispatch(keyEvent('tab'))
      expect(fm.current()).toBe(textarea)
      expect(value.value).toBe('  ')
    } finally {
      cleanup()
    }
  })

  test('textarea capture mode can bubble Tab without moving focus', async () => {
    const bubbled: string[] = []
    const { app, cleanup } = mount(() =>
      h('box', { onKeyDown: (ev: DispatchableEvent) => bubbled.push(ev.name) }, [
        h(VuiHostTextarea, {
          value: '',
          focused: true,
          tabBehavior: 'capture',
          'onUpdate:value': () => undefined,
        }),
        h('input', { focusable: true }),
      ]),
    )
    try {
      await nextTick()
      const fm = app.context.focusManager!
      const textarea = app.context.root!.children[0]!.children[0]!
      expect(fm.current()).toBe(textarea)
      fm.dispatch(keyEvent('tab'))
      expect(fm.current()).toBe(textarea)
      expect(bubbled).toEqual(['tab'])
    } finally {
      cleanup()
    }
  })
})
