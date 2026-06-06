// `VuiVirtualList` — a windowed list for large data. Where `<VuiScrollBox>` mounts
// every child and only skips *painting* the off-screen ones (Phase 02 culling),
// this mounts only the rows in (and just around) the viewport — O(visible), not
// O(total) — so 100k+ items stay smooth. It keeps the total scroll height honest
// with top/bottom spacer boxes and applies the sub-row scroll offset via the host
// `scrollY` paint shift, so scrolling is smooth within a row, not just row-snapped.
//
// Pass an explicit `height` (rows): like every scroll/clip container in this
// engine, the viewport needs a *definite* height — a flex/auto height would size to
// the (enormous) spacer content and balloon. To fill the screen, compute the height
// from `process.stdout.rows` minus your chrome. Rows are a fixed `itemHeight`
// (default 1). The default scoped slot renders one item:
// `<template #default="{ item, index }">`. Up/Down/PageUp/PageDown/Home/End and the
// mouse wheel scroll it while focused.
import { type PropType, computed, defineComponent, h, ref } from '@vue/runtime-core'
import { type DispatchableEvent, type DispatchableMouseEvent, VuiScrollBar } from '@vui-rs/vue'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

// Safety ceiling on rows mounted at once: far above any real terminal viewport,
// but it keeps a pathological `height` from trying to mount the whole dataset and
// blocking the event loop.
const MAX_WINDOW = 500

export const VuiVirtualList = defineComponent({
  name: 'VuiVirtualList',
  inheritAttrs: false,
  props: {
    items: { type: Array as PropType<unknown[]>, required: true },
    /** Viewport height in rows (definite — see the note above). */
    height: { type: Number, required: true },
    /** Rows each item occupies. */
    itemHeight: { type: Number, default: 1 },
    /** Extra rows mounted above/below the viewport to smooth fast scrolling. */
    overscan: { type: Number, default: 2 },
    focused: { type: Boolean, default: false },
    focusable: { type: Boolean, default: true },
    /** Scroll step (rows) for arrow keys / one wheel notch. */
    step: { type: Number, default: 1 },
    /** Render an integrated vertical scrollbar (indicator + drag) on the right edge. */
    scrollbar: { type: Boolean, default: false },
    /**
     * Controlled scroll offset (top row). Bind it (`v-model:scrollY` /
     * `:scrollY` + `@update:scrollY`) to drive the list from an ancestor — e.g. a
     * focused parent that owns the keyboard. Omit for uncontrolled (internal).
     */
    scrollY: { type: Number, default: undefined },
  },
  emits: ['scroll', 'update:scrollY'],
  setup(props, { attrs, emit, slots }) {
    const localScrollY = ref(0) // uncontrolled top-of-viewport, in rows

    const viewRows = computed(() => Math.max(1, props.height))
    const totalRows = computed(() => props.items.length * props.itemHeight)
    const maxScroll = computed(() => Math.max(0, totalRows.value - viewRows.value))
    // The live offset: the controlled prop when bound, else the internal ref —
    // always clamped to the current content size.
    const scrollPos = computed(() => clamp(props.scrollY ?? localScrollY.value, 0, maxScroll.value))

    const window = computed(() => {
      const ih = Math.max(1, props.itemHeight)
      const first = Math.max(0, Math.floor(scrollPos.value / ih) - props.overscan)
      const visible = Math.min(MAX_WINDOW, Math.ceil(viewRows.value / ih) + props.overscan * 2)
      const last = Math.min(props.items.length, first + visible)
      return { first, last }
    })

    function scrollTo(rows: number): void {
      const next = clamp(Math.round(rows), 0, maxScroll.value)
      if (next === scrollPos.value) return
      localScrollY.value = next
      emit('update:scrollY', next)
      emit('scroll', next)
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== 'key') return
      const page = Math.max(1, viewRows.value - 1)
      const deltas: Record<string, number> = {
        up: -props.step,
        down: props.step,
        pageUp: -page,
        pageDown: page,
        home: -scrollPos.value,
        end: maxScroll.value - scrollPos.value,
      }
      const d = deltas[ev.name]
      if (d !== undefined) {
        ev.preventDefault()
        scrollTo(scrollPos.value + d)
      }
    }

    function onWheel(ev: DispatchableMouseEvent): void {
      if (ev.type !== 'mouse' || ev.kind !== 'wheel') return
      ev.preventDefault()
      scrollTo(scrollPos.value + (ev.button === 'wheelUp' ? -props.step : props.step) * 3)
    }

    return () => {
      const { first, last } = window.value
      const ih = Math.max(1, props.itemHeight)
      const topPad = first * ih
      const bottomPad = Math.max(0, totalRows.value - last * ih)
      const rows = []
      // Spacer preserves the offset of the first mounted row; scrollY paint shift
      // then slides the window up so the right rows land in the viewport.
      if (topPad > 0) rows.push(h('box', { key: 'vl-top', height: topPad, flexShrink: 0 }))
      for (let i = first; i < last; i++) {
        rows.push(
          h('box', { key: `vl-${i}`, height: ih, flexShrink: 0 }, slots.default?.({ item: props.items[i], index: i })),
        )
      }
      if (bottomPad > 0) rows.push(h('box', { key: 'vl-bot', height: bottomPad, flexShrink: 0 }))
      const viewport = h(
        'box',
        {
          // Without a scrollbar the viewport owns the layout attrs; with one, the
          // outer row owns them and the viewport flex-grows into the space left of
          // the bar. Either way `height` is definite so the spacer is clipped, not
          // ballooned.
          ...(props.scrollbar ? { flexGrow: 1 } : attrs),
          height: props.height,
          flexDirection: 'column',
          overflow: 'scroll',
          scrollY: scrollPos.value,
          focusable: props.focusable,
          focused: props.focused,
          onKeyDown,
          onWheel,
        },
        rows,
      )
      if (!props.scrollbar) return viewport
      return h('box', { ...attrs, height: props.height, flexDirection: 'row' }, [
        viewport,
        h(VuiScrollBar, {
          scrollY: scrollPos.value,
          viewportHeight: viewRows.value,
          contentHeight: totalRows.value,
          'onUpdate:scrollY': (y: number) => scrollTo(y),
          onWheel, // wheel over the bar scrolls too
        }),
      ])
    }
  },
})
