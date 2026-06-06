import { describe, expect, test } from 'bun:test'
import { CELL_BYTES, type KeyEvent, Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { VuiHostTextarea } from '../src/host/components/textarea.ts'
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
