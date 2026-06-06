import { describe, expect, test } from 'bun:test'
import { h, nextTick, ref } from '@vue/runtime-core'
import { VuiWorkingIndicator } from '../src/working-indicator.ts'
import { allGlyphs, mount } from './helpers.ts'

describe('VuiWorkingIndicator', () => {
  test('swaps from spinner+label (busy) to check+doneLabel (done)', async () => {
    const done = ref(false)
    const { renderer, flush, cleanup } = mount(40, 3, () =>
      h(VuiWorkingIndicator, { done: done.value, label: 'Building', doneLabel: 'Built', doneGlyph: '✔' }),
    )
    await nextTick()
    flush()
    expect(allGlyphs(renderer)).toContain('Building')
    expect(allGlyphs(renderer)).not.toContain('Built')

    done.value = true
    await nextTick()
    flush()
    const screen = allGlyphs(renderer)
    expect(screen).toContain('Built')
    expect(screen).toContain('✔')
    expect(screen).not.toContain('Building')
    cleanup()
  })
})
