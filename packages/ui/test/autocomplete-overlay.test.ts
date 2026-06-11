// VuiAutocomplete presentation: the anchored overlay popup (opens upward, clamps
// to the space above, window-scrolls the active row) and the in-flow fallback.
// Runs through the real host app so layout + the overlay pass actually place the
// popup; assertions read the painted cell buffer / the live overlay registry.
import { describe, expect, test } from 'bun:test'
import { defineComponent, h, ref } from '@vue/runtime-core'
import { type ScreenMeasure } from '@vui-rs/vue'
import { VuiAutocomplete, type Suggestion } from '../src/autocomplete.ts'
import { allGlyphs, mount, mouseDown, rowGlyphs } from './helpers.ts'

function items(n: number): Suggestion[] {
  return Array.from({ length: n }, (_, i) => ({ label: `r${String(i).padStart(2, '0')}`, value: `r${i}` }))
}

function harness(initial: {
  suggestions: Suggestion[]
  active?: number
  anchor?: ScreenMeasure | null
  maxRows?: number
  emptyText?: string
}) {
  const suggestions = ref(initial.suggestions)
  const active = ref(initial.active ?? 0)
  const anchor = ref<ScreenMeasure | null>(initial.anchor ?? null)
  const selected: Array<{ value: string; index: number }> = []
  const Root = defineComponent({
    setup() {
      return () =>
        h('box', { flexDirection: 'column', width: 40, height: 12 }, [
          h(VuiAutocomplete, {
            suggestions: suggestions.value,
            active: active.value,
            anchor: anchor.value,
            maxRows: initial.maxRows ?? 8,
            emptyText: initial.emptyText,
            onSelect: (s: Suggestion, index: number) => selected.push({ value: s.value, index }),
          }),
          h('text', { key: 'marker' }, 'MARKER'),
        ])
    },
  })
  return { suggestions, active, anchor, selected, ...mount(40, 12, () => h(Root)) }
}

describe('VuiAutocomplete — in-flow fallback (no anchor)', () => {
  test('renders suggestions in normal flow, registers no overlay', async () => {
    const h = harness({ suggestions: items(3) })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(0)
    expect(allGlyphs(h.renderer)).toContain('r00')
    expect(allGlyphs(h.renderer)).toContain('r02')
    h.cleanup()
  })
})

describe('VuiAutocomplete — anchored overlay popup', () => {
  test('opens as an overlay above the anchor with no main-tree layout shift', async () => {
    // Anchor at row 6: a 3-item popup (rows=3, height=5) opens at top = 6-5 = 1.
    const h = harness({ suggestions: items(3), anchor: { x: 0, y: 6, width: 30, height: 1 } })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(1)
    // The popup body (border rows 1 and 5, suggestion rows 2..4) sits above row 6.
    expect(rowGlyphs(h.renderer, 2)).toContain('r00')
    expect(rowGlyphs(h.renderer, 4)).toContain('r02')
    // MARKER is the autocomplete's flow sibling; the popup is hoisted, so MARKER
    // stays at row 0 whether the popup is open or not (zero layout shift).
    expect(rowGlyphs(h.renderer, 0)).toContain('MARKER')

    h.suggestions.value = [] // close the popup
    await h.settle()
    expect(h.ctx.overlays.length).toBe(0)
    expect(rowGlyphs(h.renderer, 0)).toContain('MARKER') // unchanged
    h.cleanup()
  })

  test('clamps the row count to the space above the anchor', async () => {
    // Anchor at row 2: 0 rows fit above (2 - border 2) → popup hidden entirely.
    const h = harness({ suggestions: items(8), anchor: { x: 0, y: 2, width: 30, height: 1 }, maxRows: 8 })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(0) // no overlay mounts when nothing fits
    expect(allGlyphs(h.renderer)).not.toContain('r00')
    h.cleanup()
  })

  test('mouse-down on a row selects it with the correct global index', async () => {
    // 20 items, active scrolled so the window starts at 5; click the first visible row.
    const h = harness({ suggestions: items(20), active: 12, anchor: { x: 0, y: 10, width: 30, height: 1 }, maxRows: 8 })
    await h.settle()
    // rows = min(8, 20, 10-2=8) = 8; active 12 ≥ window → windowStart = 12-8+1 = 5.
    // Popup height = 10, top = 0; first suggestion row is row 1 (after top border).
    expect(rowGlyphs(h.renderer, 1)).toContain('r05')
    h.dispatch(mouseDown(2, 1)) // click first visible row
    expect(h.selected).toEqual([{ value: 'r5', index: 5 }])
    h.cleanup()
  })
})

describe('VuiAutocomplete — empty placeholder', () => {
  test('no suggestions and no emptyText renders nothing (back-compat)', async () => {
    const h = harness({ suggestions: [], anchor: { x: 0, y: 6, width: 30, height: 1 } })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(0)
    expect(rowGlyphs(h.renderer, 0)).toContain('MARKER')
    h.cleanup()
  })

  test('emptyText shows a single non-interactive placeholder row in-flow', async () => {
    const h = harness({ suggestions: [], emptyText: 'No matching items' })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(0)
    expect(allGlyphs(h.renderer)).toContain('matching')
    // The placeholder is not a selectable row: clicking it emits nothing.
    h.dispatch(mouseDown(2, 1))
    expect(h.selected).toEqual([])
    h.cleanup()
  })

  test('emptyText shows as an overlay above the anchor with no layout shift', async () => {
    // Anchor at row 6: 1 placeholder row (height = 1 + border 2 = 3) opens at top = 3.
    const h = harness({ suggestions: [], emptyText: 'No matching items', anchor: { x: 0, y: 6, width: 30, height: 1 } })
    await h.settle()
    expect(h.ctx.overlays.length).toBe(1)
    expect(rowGlyphs(h.renderer, 4)).toContain('matching') // body row of the popup
    expect(rowGlyphs(h.renderer, 0)).toContain('MARKER') // hoisted popup, MARKER unmoved

    // Suggestions arriving replaces the placeholder with real rows; clearing them
    // returns to the placeholder — the overlay stays open the whole time.
    h.suggestions.value = items(2)
    await h.settle()
    expect(allGlyphs(h.renderer)).toContain('r00')
    expect(allGlyphs(h.renderer)).not.toContain('matching')
    h.suggestions.value = []
    await h.settle()
    expect(h.ctx.overlays.length).toBe(1)
    expect(allGlyphs(h.renderer)).toContain('matching')
    h.cleanup()
  })
})

describe('VuiAutocomplete — window scrolling', () => {
  test('slides the window so the active row stays visible; wrap resets to top', async () => {
    const h = harness({ suggestions: items(20), active: 0, maxRows: 8 }) // in-flow, 8 rows
    await h.settle()
    expect(allGlyphs(h.renderer)).toContain('r00')
    expect(allGlyphs(h.renderer)).toContain('r07')
    expect(allGlyphs(h.renderer)).not.toContain('r08')

    h.active.value = 8 // past the window → slides to show 1..8
    await h.settle()
    expect(allGlyphs(h.renderer)).toContain('r08')
    expect(allGlyphs(h.renderer)).not.toContain('r00')

    h.active.value = 0 // wrap to the top → window resets
    await h.settle()
    expect(allGlyphs(h.renderer)).toContain('r00')
    expect(allGlyphs(h.renderer)).not.toContain('r08')
    h.cleanup()
  })
})
