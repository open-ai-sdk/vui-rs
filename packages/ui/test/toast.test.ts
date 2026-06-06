import { describe, expect, test } from 'bun:test'
import { defineComponent, h, nextTick } from '@vue/runtime-core'
import { type ToastController, VuiToastHost, provideToasts } from '../src/toast.ts'
import { allGlyphs, mount } from './helpers.ts'

function mountToasts() {
  let controller!: ToastController
  const Root = defineComponent({
    setup() {
      controller = provideToasts()
      return () => h('box', {}, h(VuiToastHost, {}))
    },
  })
  const harness = mount(60, 12, () => h(Root))
  return {
    ...harness,
    get controller() {
      return controller
    },
  }
}

describe('toasts', () => {
  test('show adds a toast, dismiss removes it', () => {
    const { controller, cleanup } = mountToasts()
    const id = controller.show('Saved', { kind: 'success' })
    expect(controller.toasts.length).toBe(1)
    controller.dismiss(id)
    expect(controller.toasts.length).toBe(0)
    cleanup()
  })

  test('clear removes every toast', () => {
    const { controller, cleanup } = mountToasts()
    controller.show('a')
    controller.show('b')
    expect(controller.toasts.length).toBe(2)
    controller.clear()
    expect(controller.toasts.length).toBe(0)
    cleanup()
  })

  test('VuiToastHost paints the toast message', async () => {
    const { controller, renderer, settle, cleanup } = mountToasts()
    controller.show('Hello', { kind: 'info', duration: 0 })
    await settle()
    expect(allGlyphs(renderer)).toContain('Hello')
    cleanup()
  })
})
