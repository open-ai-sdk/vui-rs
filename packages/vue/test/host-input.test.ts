// Phase 06.5: the JS-host interactive runtime — focus traversal, key dispatch +
// bubble, and `<input>` typing (the JS edit model + v-model). Runs offscreen
// (injected renderer, no terminal session); key events are fed straight to the
// focus manager, exactly as the terminal session would.
import { describe, expect, test } from 'bun:test'
import { type KeyEvent, Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { VuiHostInput } from '../src/host/components/input.ts'
import type { EditRenderable } from '../src/host/edit-renderable.ts'
import type { Renderable } from '../src/host/renderable.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { type: 'key', name, ctrl: false, alt: false, shift: false, meta: false, raw: name, ...mods }
}

function mount(render: () => unknown) {
  const r = new Renderer(40, 6)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    ctx: app.context,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('host focus manager', () => {
  test('Tab traversal cycles focusable nodes in DFS order', () => {
    const { ctx, cleanup } = mount(() =>
      h('box', {}, [
        h('box', { focusable: true, key: 'a' }),
        h('box', {}, [h('box', { focusable: true, key: 'b' })]),
        h('box', { focusable: true, key: 'c' }),
      ]),
    )
    const fm = ctx.focusManager!
    fm.focusNext()
    const first = fm.current()
    fm.focusNext()
    const second = fm.current()
    fm.focusNext()
    const third = fm.current()
    fm.focusNext() // wraps
    expect(fm.current()).toBe(first)
    expect(new Set([first, second, third]).size).toBe(3) // three distinct nodes
    cleanup()
  })

  test('a key dispatches to the focused node then bubbles to ancestors', () => {
    const hits: string[] = []
    let child!: Renderable
    const { ctx, cleanup } = mount(() =>
      h('box', { onKeyDown: () => hits.push('parent') }, [
        h('box', {
          focusable: true,
          ref: (el: unknown) => {
            child = el as Renderable
          },
          onKeyDown: () => hits.push('child'),
        }),
      ]),
    )
    ctx.focusManager!.focus(child)
    ctx.focusManager!.dispatch(key('x'))
    expect(hits).toEqual(['child', 'parent']) // child first, then bubbles to parent
    cleanup()
  })

  test('preventDefault stops the bubble', () => {
    const hits: string[] = []
    let child!: Renderable
    const { ctx, cleanup } = mount(() =>
      h('box', { onKeyDown: () => hits.push('parent') }, [
        h('box', {
          focusable: true,
          ref: (el: unknown) => {
            child = el as Renderable
          },
          onKeyDown: (e: { preventDefault: () => void }) => {
            hits.push('child')
            e.preventDefault()
          },
        }),
      ]),
    )
    ctx.focusManager!.focus(child)
    ctx.focusManager!.dispatch(key('x'))
    expect(hits).toEqual(['child']) // parent never reached
    cleanup()
  })
})

describe('<input> typing (JS edit model + v-model)', () => {
  function mountInput(initial: string) {
    const value = ref(initial)
    const { ctx, cleanup } = mount(() =>
      h(VuiHostInput, { value: value.value, focused: true, 'onUpdate:value': (v: string) => (value.value = v) }),
    )
    return { ctx, value, cleanup }
  }

  test('printable keys insert at the cursor and update v-model', async () => {
    const { ctx, value, cleanup } = mountInput('ab')
    await nextTick() // let the input mount + focus
    ctx.focusManager!.dispatch(key('c'))
    ctx.focusManager!.dispatch(key('d'))
    expect(value.value).toBe('abcd') // appended at end (cursor after setValue)
    cleanup()
  })

  test('backspace, home, and mid-string insert', async () => {
    const { ctx, value, cleanup } = mountInput('abc')
    await nextTick()
    const fm = ctx.focusManager!
    fm.dispatch(key('backspace')) // "ab"
    expect(value.value).toBe('ab')
    fm.dispatch(key('home')) // cursor → 0
    fm.dispatch(key('Z')) // insert at start
    expect(value.value).toBe('Zab')
    cleanup()
  })

  test('maxLength caps insertion', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostInput, {
        value: value.value,
        focused: true,
        maxLength: 3,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    for (const c of 'abcdef') ctx.focusManager!.dispatch(key(c))
    expect(value.value).toBe('abc') // capped at 3
    cleanup()
  })
})

describe('controlled <input> focus is reactive (:focused prop)', () => {
  test('flipping focused after mount focuses then blurs the input', async () => {
    const focused = ref(false)
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostInput, {
        value: value.value,
        focused: focused.value,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    const fm = ctx.focusManager!
    expect(fm.current()).toBeNull() // not focused at mount (focused=false)

    // Regression: before forwarding `focused` to the host element, this stayed
    // null — the prop was write-once, so an input could never regain focus after
    // (e.g.) a dialog closed, leaving it dead until a manual click.
    focused.value = true
    await nextTick()
    expect(fm.current()).not.toBeNull()
    expect(fm.current()!.kind).toBe('edit')

    fm.dispatch(key('x')) // focus is real: typing reaches the edit model
    expect(value.value).toBe('x')

    focused.value = false
    await nextTick()
    expect(fm.current()).toBeNull() // blurs reactively too
    cleanup()
  })
})

describe('form integration (Tab between two inputs + typing)', () => {
  test('Tab moves focus and each input edits independently', async () => {
    const a = ref('')
    const b = ref('')
    const { ctx, cleanup } = mount(() =>
      h('box', { flexDirection: 'column' }, [
        h(VuiHostInput, { value: a.value, 'onUpdate:value': (v: string) => (a.value = v) }),
        h(VuiHostInput, { value: b.value, 'onUpdate:value': (v: string) => (b.value = v) }),
      ]),
    )
    await nextTick()
    const fm = ctx.focusManager!
    fm.focusNext() // → first input
    fm.dispatch(key('h'))
    fm.dispatch(key('i'))
    fm.focusNext() // → second input
    fm.dispatch(key('y'))
    fm.dispatch(key('o'))
    expect(a.value).toBe('hi')
    expect(b.value).toBe('yo')
    cleanup()
  })
})

describe('EditRenderable model (unit)', () => {
  test('insert / move / delete operate on graphemes', () => {
    const { ctx, cleanup } = mount(() =>
      h('input', { ref: (el: unknown) => ((globalThis as Record<string, unknown>).__e = el) }),
    )
    const e = (globalThis as Record<string, unknown>).__e as EditRenderable
    e.setValue('héllo') // é is one grapheme
    expect(e.getValue()).toBe('héllo')
    e.move(0 /* Left */) // from end → before 'o'
    e.insert('X')
    expect(e.getValue()).toBe('héllXo')
    e.backspace()
    expect(e.getValue()).toBe('héllo')
    delete (globalThis as Record<string, unknown>).__e
    cleanup()
  })
})
