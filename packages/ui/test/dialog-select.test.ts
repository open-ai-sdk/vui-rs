import { describe, expect, test } from 'bun:test'
import { h, nextTick, ref } from '@vue/runtime-core'
import { VuiDialogSelect } from '../src/dialog-select.ts'
import { allGlyphs, key, mount, mouseMove, rowGlyphs } from './helpers.ts'

const ITEMS = ['Open File', 'Close File', 'Save As', 'Open Folder']

function mountSelect() {
  const selected: Array<string | number> = []
  const highlighted: Array<string | number> = []
  const open = ref(true)
  const harness = mount(60, 16, () =>
    h(VuiDialogSelect, {
      open: open.value,
      title: 'Pick',
      items: ITEMS,
      'onUpdate:open': (v: boolean) => (open.value = v),
      onSelect: (v: string | number) => selected.push(v),
      onHighlight: (v: string | number) => highlighted.push(v),
    }),
  )
  return { ...harness, selected, highlighted, open }
}

function rowOf(renderer: Parameters<typeof rowGlyphs>[0], label: string): number {
  for (let row = 0; row < 16; row++) {
    if (rowGlyphs(renderer, row).replace(/ /g, '').includes(label)) return row
  }
  return -1
}

describe('VuiDialogSelect', () => {
  test('typing filters the list (fuzzy)', async () => {
    const { renderer, dispatch, settle, cleanup } = mountSelect()
    await nextTick()
    dispatch(key('s'))
    dispatch(key('a'))
    await settle()
    const screen = allGlyphs(renderer)
    expect(screen).toContain('SaveAs')
    expect(screen).not.toContain('CloseFile')
    cleanup()
  })

  test('Down moves the active row and Enter selects it', async () => {
    const { dispatch, selected, cleanup } = mountSelect()
    await nextTick()
    dispatch(key('down')) // active 0 -> 1 (Close File)
    dispatch(key('enter'))
    expect(selected).toEqual(['Close File'])
    cleanup()
  })

  test('hovering a row moves the active highlight (mouse)', async () => {
    const { renderer, dispatch, settle, selected, cleanup } = mountSelect()
    await settle()
    // Locate the 'Save As' row (index 2) on screen, then hover it.
    let y = -1
    for (let row = 0; row < 16; row++) {
      if (rowGlyphs(renderer, row).replace(/ /g, '').includes('SaveAs')) {
        y = row
        break
      }
    }
    expect(y).toBeGreaterThanOrEqual(0)
    dispatch(mouseMove(10, y)) // hover → active becomes the Save As row
    dispatch(key('enter')) // commit the hovered row
    expect(selected).toEqual(['Save As'])
    cleanup()
  })

  test('Enter on a filtered list selects the match', async () => {
    const { dispatch, selected, cleanup } = mountSelect()
    await nextTick()
    dispatch(key('s'))
    dispatch(key('a'))
    dispatch(key('enter'))
    expect(selected).toEqual(['Save As'])
    cleanup()
  })

  test('the search input paints the typed query (not just filters)', async () => {
    const { renderer, dispatch, settle, cleanup } = mountSelect()
    await nextTick()
    // 'zz' matches nothing, so it can only appear if the input itself is painted.
    dispatch(key('z'))
    dispatch(key('z'))
    await settle()
    expect(allGlyphs(renderer)).toContain('zz')
    cleanup()
  })

  test('Esc closes without selecting', async () => {
    const { dispatch, selected, open, cleanup } = mountSelect()
    await nextTick()
    dispatch(key('escape'))
    expect(open.value).toBe(false)
    expect(selected).toEqual([])
    cleanup()
  })

  test('emits highlight for the initial focused row on open', async () => {
    const { highlighted, cleanup } = mountSelect()
    await nextTick()
    expect(highlighted).toEqual(['Open File'])
    cleanup()
  })

  test('emits highlight as the active row moves (keyboard)', async () => {
    const { dispatch, highlighted, cleanup } = mountSelect()
    await nextTick()
    dispatch(key('down')) // 0 -> 1
    await nextTick()
    dispatch(key('down')) // 1 -> 2
    await nextTick()
    expect(highlighted).toEqual(['Open File', 'Close File', 'Save As'])
    cleanup()
  })

  test('does not re-emit highlight for an unchanged focused row (hover active row)', async () => {
    const { renderer, dispatch, settle, highlighted, cleanup } = mountSelect()
    await settle()
    const before = highlighted.length // initial 'Open File' emit
    const y = rowOf(renderer, 'OpenFile')
    expect(y).toBeGreaterThanOrEqual(0)
    dispatch(mouseMove(10, y)) // hover the already-active row → same value, no new emit
    await settle()
    expect(highlighted.length).toBe(before)
    cleanup()
  })
})
