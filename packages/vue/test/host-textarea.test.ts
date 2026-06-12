import { describe, expect, test } from 'bun:test'
import { CELL_BYTES, type KeyEvent, Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { VuiHostTextarea } from '../src/host/components/textarea.ts'
import type { DispatchableEvent } from '../src/host/focus.ts'
import type { TextareaRenderable } from '../src/host/textarea-renderable.ts'
import { defineComponent, h, nextTick, ref } from '../src/index.ts'
import { allGlyphs } from './helpers/read-buffer.ts'

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return {
    type: 'key',
    name,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: name,
    ...mods,
  }
}

function mount(render: () => unknown) {
  const r = new Renderer(30, 5)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    r,
    ctx: app.context,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

describe('<textarea> native editor', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  test('default enter inserts newline and emits enter', async () => {
    const value = ref('hello')
    const enterValues: string[] = []
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        'onUpdate:value': (v: string) => (value.value = v),
        onEnter: (v: string) => enterValues.push(v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('enter'))
    expect(value.value).toBe('hello\n')
    expect(enterValues).toEqual(['hello\n'])
    cleanup()
  })

  test('printable keys, enter, and undo update v-model', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    const fm = ctx.focusManager!
    for (const c of 'hi') fm.dispatch(key(c))
    fm.dispatch(key('enter'))
    for (const c of 'there') fm.dispatch(key(c))
    expect(value.value).toBe('hi\nthere')
    fm.dispatch(key('z', { ctrl: true }))
    expect(value.value).toBe('hi\n')
    cleanup()
  })

  test('submit enterBehavior emits submit without mutating the textarea value', async () => {
    const value = ref('send me')
    const submitValues: string[] = []
    const inputValues: string[] = []
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        enterBehavior: 'submit',
        'onUpdate:value': (v: string) => (value.value = v),
        onInput: (v: string) => inputValues.push(v),
        onSubmit: (v: string) => submitValues.push(v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('enter'))
    expect(value.value).toBe('send me')
    expect(inputValues).toEqual([])
    expect(submitValues).toEqual(['send me'])
    cleanup()
  })

  test('submit enterBehavior lets the newline shortcut insert a newline without submitting', async () => {
    const value = ref('line')
    const enterValues: string[] = []
    const submitValues: string[] = []
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        enterBehavior: 'submit',
        newlineShortcut: 'ctrl+enter',
        'onUpdate:value': (v: string) => (value.value = v),
        onEnter: (v: string) => enterValues.push(v),
        onSubmit: (v: string) => submitValues.push(v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('enter', { ctrl: true }))
    expect(value.value).toBe('line\n')
    expect(enterValues).toEqual(['line\n'])
    expect(submitValues).toEqual([])
    cleanup()
  })

  test('submit enterBehavior can opt into linefeed as the newline shortcut fallback', async () => {
    const value = ref('line')
    const enterValues: string[] = []
    const submitValues: string[] = []
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        enterBehavior: 'submit',
        newlineShortcut: 'ctrl+enter',
        newlineShortcutFallback: 'linefeed',
        'onUpdate:value': (v: string) => (value.value = v),
        onEnter: (v: string) => enterValues.push(v),
        onSubmit: (v: string) => submitValues.push(v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('enter', { raw: '\n' }))
    expect(value.value).toBe('line\n')
    expect(enterValues).toEqual(['line\n'])
    expect(submitValues).toEqual([])
    cleanup()
  })

  test('linefeed fallback is opt-in in submit mode', async () => {
    const value = ref('send me')
    const submitValues: string[] = []
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        enterBehavior: 'submit',
        'onUpdate:value': (v: string) => (value.value = v),
        onSubmit: (v: string) => submitValues.push(v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('enter', { raw: '\n' }))
    expect(value.value).toBe('send me')
    expect(submitValues).toEqual(['send me'])
    cleanup()
  })

  test('v-model echo after render ticks does not clear undo history', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    const fm = ctx.focusManager!
    fm.dispatch(key('a'))
    await nextTick()
    ctx.flushNow()
    fm.dispatch(key('b'))
    await nextTick()
    ctx.flushNow()
    expect(value.value).toBe('ab')
    fm.dispatch(key('z', { ctrl: true }))
    expect(value.value).toBe('')
    cleanup()
  })

  test('tabBehavior indent inserts spaces inside textarea', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        tabBehavior: 'indent',
        tabSize: 2,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('tab'))
    ctx.focusManager!.dispatch(key('x'))
    expect(value.value).toBe('  x')
    cleanup()
  })

  test('tabBehavior indent repaints cursor after inserted spaces', async () => {
    const cursorColor = 0x123456ff
    const { r, ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: '',
        focused: true,
        width: 10,
        height: 1,
        tabBehavior: 'indent',
        tabSize: 2,
        cursorColor,
      }),
    )
    await nextTick()
    ctx.flushNow()
    ctx.focusManager!.dispatch(key('tab'))
    ctx.flushNow()
    expect(cellBg(r, 2, 0)).toBe(cursorColor)
    cleanup()
  })

  test('readline delete shortcuts match input behavior', async () => {
    for (const ev of [key('w', { ctrl: true }), key('backspace', { ctrl: true }), key('backspace', { alt: true })]) {
      const value = ref('hello world')
      const { ctx, cleanup } = mount(() =>
        h(VuiHostTextarea, {
          value: value.value,
          focused: true,
          'onUpdate:value': (v: string) => (value.value = v),
        }),
      )
      await nextTick()
      ctx.focusManager!.dispatch(ev)
      expect(value.value).toBe('hello ')
      cleanup()
    }

    const start = ref('hello world')
    const { ctx: startCtx, cleanup: cleanupStart } = mount(() =>
      h(VuiHostTextarea, {
        value: start.value,
        focused: true,
        'onUpdate:value': (v: string) => (start.value = v),
      }),
    )
    await nextTick()
    startCtx.focusManager!.dispatch(key('u', { ctrl: true }))
    expect(start.value).toBe('')
    cleanupStart()

    const end = ref('hello world')
    const { ctx: endCtx, cleanup: cleanupEnd } = mount(() =>
      h(VuiHostTextarea, {
        value: end.value,
        focused: true,
        'onUpdate:value': (v: string) => (end.value = v),
      }),
    )
    await nextTick()
    endCtx.focusManager!.dispatch(key('home'))
    endCtx.focusManager!.dispatch(key('k', { ctrl: true }))
    expect(end.value).toBe('')
    cleanupEnd()
  })

  test('maxLength caps textarea typing, paste, and newline insertion', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        maxLength: 3,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    const fm = ctx.focusManager!
    for (const c of 'abcd') fm.dispatch(key(c))
    expect(value.value).toBe('abc')
    fm.dispatch({ type: 'paste', text: 'def' })
    expect(value.value).toBe('abc')
    cleanup()

    const value2 = ref('ab')
    const { ctx: ctx2, cleanup: cleanup2 } = mount(() =>
      h(VuiHostTextarea, {
        value: value2.value,
        focused: true,
        maxLength: 3,
        'onUpdate:value': (v: string) => (value2.value = v),
      }),
    )
    await nextTick()
    ctx2.focusManager!.dispatch(key('enter'))
    expect(value2.value).toBe('ab\n')
    ctx2.focusManager!.dispatch(key('enter'))
    expect(value2.value).toBe('ab\n')
    cleanup2()
  })

  test('cursor blink toggles the native textarea cursor and resets on typing', async () => {
    const cursorColor = 0x123456ff
    const { r, ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: '',
        width: 5,
        height: 1,
        cursorColor,
      }),
    )
    await nextTick()
    const textarea = ctx.root!.children[0] as TextareaRenderable
    textarea.setBlinkInterval(10)
    ctx.focusManager!.focus(textarea)
    ctx.flushNow()
    expect(textarea.textarea.cursorVisible).toBe(true)
    expect(cellBg(r, 0, 0)).toBe(cursorColor)
    await sleep(15)
    ctx.flushNow()
    expect(textarea.textarea.cursorVisible).toBe(false)
    expect(cellBg(r, 0, 0)).not.toBe(cursorColor)
    ctx.focusManager!.dispatch(key('a'))
    ctx.flushNow()
    expect(textarea.textarea.cursorVisible).toBe(true)
    cleanup()
  })

  test('cursorBlink disabled keeps textarea cursor steady', async () => {
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: '',
        width: 5,
        height: 1,
        cursorBlink: false,
      }),
    )
    await nextTick()
    const textarea = ctx.root!.children[0] as TextareaRenderable
    ctx.focusManager!.focus(textarea)
    expect(textarea.textarea.cursorVisible).toBe(true)
    await sleep(20)
    expect(textarea.textarea.cursorVisible).toBe(true)
    cleanup()
  })

  test('copy cut and paste operate on textarea selection', async () => {
    const value = ref('hello')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    const fm = ctx.focusManager!
    fm.dispatch(key('home', { ctrl: true }))
    fm.dispatch(key('right', { shift: true }))
    fm.dispatch(key('right', { shift: true }))
    fm.dispatch(key('c', { ctrl: true }))
    expect(value.value).toBe('hello')
    fm.dispatch(key('end', { ctrl: true }))
    fm.dispatch(key('v', { ctrl: true }))
    expect(value.value).toBe('hellohe')
    fm.dispatch(key('z', { ctrl: true }))
    fm.dispatch(key('home', { ctrl: true }))
    fm.dispatch(key('right', { shift: true }))
    fm.dispatch(key('right', { shift: true }))
    fm.dispatch(key('x', { ctrl: true }))
    expect(value.value).toBe('llo')
    fm.dispatch(key('v', { ctrl: true }))
    expect(value.value).toBe('hello')
    cleanup()
  })

  test('bracketed paste inserts pasted text regardless of internal clipboard', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: value.value,
        focused: true,
        'onUpdate:value': (v: string) => (value.value = v),
      }),
    )
    await nextTick()
    ctx.focusManager!.dispatch({ type: 'paste', text: 'from-terminal' })
    expect(value.value).toBe('from-terminal')
    cleanup()
  })

  test('renders multiline content through the native editor view', async () => {
    const { r, ctx, cleanup } = mount(() => h(VuiHostTextarea, { value: 'one\ntwo', width: 10, height: 3 }))
    await nextTick()
    ctx.flushNow()
    expect(allGlyphs(r)).toContain('onetwo')
    cleanup()
  })

  test('auto-height clamps to maxHeight for multiline content', async () => {
    const { ctx, cleanup } = mount(() => h(VuiHostTextarea, { value: 'one\ntwo\nthree', width: 10, maxHeight: 2 }))
    await nextTick()
    ctx.flushNow()
    const textarea = ctx.root!.children[0] as TextareaRenderable
    expect(textarea.rect!.h).toBe(2)
    cleanup()
  })

  test('auto-height uses laid-out percent width and border chrome for soft wraps', async () => {
    const value = ref('')
    const { ctx, cleanup } = mount(() =>
      h('box', { width: 10 }, [
        h(VuiHostTextarea, {
          value: value.value,
          focused: true,
          width: { pct: 1 },
          border: 'rounded',
          minHeight: 3,
          maxHeight: 6,
          'onUpdate:value': (v: string) => (value.value = v),
        }),
      ]),
    )
    await nextTick()
    ctx.flushNow()
    const textarea = ctx.root!.children[0]!.children[0] as TextareaRenderable
    expect(textarea.rect!.h).toBe(3)
    for (const c of 'abcdefghijk') ctx.focusManager!.dispatch(key(c))
    await nextTick()
    ctx.flushNow()
    expect(textarea.editor.measure(8, 'word').lineCount).toBe(2)
    expect(textarea.rect!.h).toBe(4)
    cleanup()
  })

  test('bubbleKeys lets wrapper handlers own selected textarea keys', async () => {
    const bubbled: string[] = []
    const { ctx, cleanup } = mount(() =>
      h('box', { onKeyDown: (ev: DispatchableEvent) => bubbled.push(ev.name) }, [
        h(VuiHostTextarea, {
          value: 'one\ntwo',
          focused: true,
          bubbleKeys: ['up', 'down'],
        }),
      ]),
    )
    await nextTick()
    ctx.focusManager!.dispatch(key('down'))
    ctx.focusManager!.dispatch(key('up'))
    expect(bubbled).toEqual(['down', 'up'])
    cleanup()
  })

  test('up and down keys move across wrapped visual rows', async () => {
    const { ctx, cleanup } = mount(() =>
      h(VuiHostTextarea, {
        value: 'abcdef',
        width: 3,
        height: 2,
        focused: true,
        wrap: 'char',
      }),
    )
    await nextTick()
    ctx.flushNow()
    const textarea = ctx.root!.children[0] as TextareaRenderable
    ctx.focusManager!.dispatch(key('home', { ctrl: true }))
    ctx.focusManager!.dispatch(key('down'))
    expect(textarea.edit.cursor()).toEqual({ row: 0, col: 3 })
    ctx.focusManager!.dispatch(key('up'))
    expect(textarea.edit.cursor()).toEqual({ row: 0, col: 0 })
    cleanup()
  })
})

function cellBg(r: Renderer, x: number, y: number): number {
  const buf = r.backBufferView()
  const base = (y * r.width + x) * CELL_BYTES + 8
  return ((buf[base]! << 24) | (buf[base + 1]! << 16) | (buf[base + 2]! << 8) | buf[base + 3]!) >>> 0
}
