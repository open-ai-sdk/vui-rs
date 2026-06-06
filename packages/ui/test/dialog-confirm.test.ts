import { describe, expect, test } from 'bun:test'
import { h, nextTick, ref } from '@vue/runtime-core'
import { VuiDialogConfirm } from '../src/dialog-confirm.ts'
import { key, mount } from './helpers.ts'

function mountConfirm() {
  const open = ref(true)
  const decisions: boolean[] = []
  const harness = mount(50, 12, () =>
    h(VuiDialogConfirm, {
      open: open.value,
      message: 'Delete it?',
      'onUpdate:open': (v: boolean) => (open.value = v),
      onConfirm: (v: boolean) => decisions.push(v),
    }),
  )
  return { ...harness, decisions, open }
}

describe('VuiDialogConfirm', () => {
  test('Enter commits the default (Yes) choice', async () => {
    const { dispatch, decisions, open, cleanup } = mountConfirm()
    await nextTick()
    dispatch(key('enter'))
    expect(decisions).toEqual([true])
    expect(open.value).toBe(false)
    cleanup()
  })

  test('Left toggles the highlight, then Enter commits No', async () => {
    const { dispatch, decisions, cleanup } = mountConfirm()
    await nextTick()
    dispatch(key('left'))
    dispatch(key('enter'))
    expect(decisions).toEqual([false])
    cleanup()
  })

  test('n / y are shortcuts', async () => {
    const { dispatch, decisions, cleanup } = mountConfirm()
    await nextTick()
    dispatch(key('n'))
    expect(decisions).toEqual([false])
    cleanup()
  })

  test('Esc cancels (closes, no decision)', async () => {
    const { dispatch, decisions, open, cleanup } = mountConfirm()
    await nextTick()
    dispatch(key('escape'))
    expect(open.value).toBe(false)
    expect(decisions).toEqual([])
    cleanup()
  })
})
