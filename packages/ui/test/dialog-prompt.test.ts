import { describe, expect, test } from 'bun:test'
import { h, nextTick, ref } from '@vue/runtime-core'
import { VuiDialogPrompt } from '../src/dialog-prompt.ts'
import { key, mount } from './helpers.ts'

function mountPrompt(validate?: (v: string) => string | null) {
  const open = ref(true)
  const submitted: string[] = []
  const harness = mount(60, 12, () =>
    h(VuiDialogPrompt, {
      open: open.value,
      title: 'Rename',
      validate,
      'onUpdate:open': (v: boolean) => (open.value = v),
      onSubmit: (v: string) => submitted.push(v),
    }),
  )
  return { ...harness, submitted, open }
}

describe('VuiDialogPrompt', () => {
  test('typing then Enter submits the value', async () => {
    const { dispatch, submitted, open, cleanup } = mountPrompt()
    await nextTick()
    dispatch(key('a'))
    dispatch(key('b'))
    dispatch(key('enter'))
    expect(submitted).toEqual(['ab'])
    expect(open.value).toBe(false)
    cleanup()
  })

  test('validate blocks submit while invalid, allows it once valid', async () => {
    const validate = (v: string) => (v.length < 2 ? 'too short' : null)
    const { dispatch, submitted, open, cleanup } = mountPrompt(validate)
    await nextTick()
    dispatch(key('x')) // value "x" — invalid
    dispatch(key('enter'))
    expect(submitted).toEqual([]) // blocked
    expect(open.value).toBe(true)
    dispatch(key('y')) // value "xy" — valid
    dispatch(key('enter'))
    expect(submitted).toEqual(['xy'])
    expect(open.value).toBe(false)
    cleanup()
  })

  test('Esc cancels without submitting', async () => {
    const { dispatch, submitted, open, cleanup } = mountPrompt()
    await nextTick()
    dispatch(key('escape'))
    expect(open.value).toBe(false)
    expect(submitted).toEqual([])
    cleanup()
  })
})
