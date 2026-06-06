import { describe, expect, test } from 'bun:test'
import { h, nextTick } from '@vue/runtime-core'
import { VuiStatusBar } from '../src/status-bar.ts'
import { allGlyphs, mount } from './helpers.ts'

describe('VuiStatusBar', () => {
  test('renders left / center / right slots across the row', async () => {
    const { renderer, flush, cleanup } = mount(40, 3, () =>
      h(
        VuiStatusBar,
        {},
        {
          left: () => h('text', {}, 'LEFT'),
          center: () => h('text', {}, 'MID'),
          right: () => h('text', {}, 'RIGHT'),
        },
      ),
    )
    await nextTick()
    flush()
    const screen = allGlyphs(renderer)
    expect(screen).toContain('LEFT')
    expect(screen).toContain('MID')
    expect(screen).toContain('RIGHT')
    cleanup()
  })

  test('falls back to the default slot for the center region', async () => {
    const { renderer, flush, cleanup } = mount(40, 3, () =>
      h(VuiStatusBar, {}, { default: () => h('text', {}, 'STATUS') }),
    )
    await nextTick()
    flush()
    expect(allGlyphs(renderer)).toContain('STATUS')
    cleanup()
  })
})
