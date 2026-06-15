import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { defineComponent, h, nextTick } from '../src/index.ts'
import { cellGlyph } from './helpers/read-buffer.ts'

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    renderer: r,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

/**
 * A column box with an open rail + a left gutter, holding `rows` text lines. Sized
 * to its content height so the foot anchors at the last content row (a box left to
 * stretch would fill the terminal and put the foot at the screen bottom — the rail
 * foot tracks the box's content-box bottom by design, not the last Vue child).
 */
function railBox(rows: string[], extra: Record<string, unknown> = {}) {
  return h(
    'box',
    {
      flexDirection: 'column',
      alignItems: 'stretch',
      alignSelf: 'flex-start',
      height: rows.length,
      rail: 'open',
      padding: { left: 2 },
      ...extra,
    },
    rows.map((t) => h('text', { wrap: 'nowrap' }, t)),
  )
}

describe('rail paint primitive', () => {
  test('paints a │ spine down the left gutter and a ╰─ foot', async () => {
    const { renderer, cleanup } = mount(20, 6, () => railBox(['aaa', 'bbb', 'ccc']))
    await nextTick()
    // 3 content rows → content-box bottom = row 2 (the foot row).
    expect(cellGlyph(renderer, 0, 0)).toBe('│')
    expect(cellGlyph(renderer, 0, 1)).toBe('│')
    expect(cellGlyph(renderer, 0, 2)).toBe('╰')
    expect(cellGlyph(renderer, 1, 2)).toBe('─')
    cleanup()
  })

  test('children paint in the content box, clear of the rail column', async () => {
    const { renderer, cleanup } = mount(20, 6, () => railBox(['aaa', 'bbb', 'ccc']))
    await nextTick()
    // padding.left = 2 → text starts at column 2; the gutter (cols 0..1) is the rail's.
    expect(cellGlyph(renderer, 2, 0)).toBe('a')
    expect(cellGlyph(renderer, 2, 1)).toBe('b')
    expect(cellGlyph(renderer, 2, 2)).toBe('c')
    cleanup()
  })

  test('no rail painted when rail is default (none)', async () => {
    const { renderer, cleanup } = mount(20, 6, () =>
      h(
        'box',
        { flexDirection: 'column', alignItems: 'stretch', padding: { left: 2 } },
        ['aaa', 'bbb'].map((t) => h('text', { wrap: 'nowrap' }, t)),
      ),
    )
    await nextTick()
    expect(cellGlyph(renderer, 0, 0)).toBe(' ')
    expect(cellGlyph(renderer, 0, 1)).toBe(' ')
    cleanup()
  })

  test('does not shift child layout vs the same box without a rail', async () => {
    const railed = mount(20, 6, () => railBox(['hello']))
    await nextTick()
    const plain = mount(20, 6, () =>
      h('box', { flexDirection: 'column', alignItems: 'stretch', padding: { left: 2 } }, [
        h('text', { wrap: 'nowrap' }, 'hello'),
      ]),
    )
    await nextTick()
    // Same content cell in both — the rail lives in the gutter, not in layout.
    for (let x = 2; x < 7; x++) {
      expect(cellGlyph(railed.renderer, x, 0)).toBe(cellGlyph(plain.renderer, x, 0))
    }
    railed.cleanup()
    plain.cleanup()
  })
})
