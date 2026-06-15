import { defineComponent, h, nextTick, onMounted, onUnmounted, shallowRef, watch } from '@vue/runtime-core'
import type { DispatchableEvent, DispatchableMouseEvent } from '../focus.ts'
import type { Renderable } from '../renderable.ts'
import { VuiScrollBar } from './scroll-bar.ts'

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, Math.floor(max))))
}

function rectContentHeight(node: Renderable | undefined): number {
  const rect = node?.rect
  if (!rect) return 0
  return Math.max(0, Math.round(rect.h - rect.border.top - rect.border.bottom - rect.padding.top - rect.padding.bottom))
}

function laidOutHeight(node: Renderable | undefined): number {
  const rect = node?.rect
  if (!node || !rect) return 0
  let h = Math.round(rect.h)
  for (const child of node.children) {
    if (!child.rect) continue
    h = Math.max(h, Math.round(child.rect.y + laidOutHeight(child)))
  }
  return h
}

interface ViewState {
  y: number
  viewportHeight: number
  contentHeight: number
}

export const VuiScrollBox = defineComponent({
  name: 'VuiScrollBox',
  inheritAttrs: false,
  props: {
    modelValue: { type: Number, default: undefined },
    scrollY: { type: Number, default: undefined },
    step: { type: Number, default: 1 },
    pageStep: { type: Number, default: undefined },
    focused: { type: Boolean, default: false },
    focusable: { type: Boolean, default: true },
    /**
     * Chat/transcript mode: keep the view pinned to the bottom as content grows,
     * unless the user has scrolled up. Uncontrolled only — don't bind modelValue.
     */
    stickToBottom: { type: Boolean, default: false },
    /** Render an integrated vertical scrollbar (indicator + drag) on the right edge. */
    scrollbar: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'update:scrollY', 'scroll'],
  setup(props, { attrs, emit, slots, expose }) {
    const viewport = shallowRef<Renderable>()
    let localScrollY = 0
    // Whether the view is pinned to the bottom (stickToBottom). Flipped off when
    // the user scrolls away from the bottom, back on when they return to it.
    let stuck = props.stickToBottom
    // Reactive geometry the integrated scrollbar renders from; refreshed whenever
    // the scroll offset or content size changes (incl. stick-to-bottom in
    // afterLayout), so the thumb follows even when nothing else re-renders.
    const view = shallowRef<ViewState>({ y: 0, viewportHeight: 0, contentHeight: 0 })

    const currentProp = (): number | undefined => props.scrollY ?? props.modelValue

    function maxScroll(): number {
      let contentHeight = rectContentHeight(viewport.value)
      for (const child of viewport.value?.children ?? []) {
        if (!child.rect) continue
        contentHeight = Math.max(contentHeight, Math.round(child.rect.y + laidOutHeight(child)))
      }
      return Math.max(0, Math.round(contentHeight - rectContentHeight(viewport.value)))
    }

    function current(): number {
      return clamp(currentProp() ?? localScrollY, maxScroll())
    }

    // Recompute the scrollbar geometry from the latest rects; only writes (and so
    // re-renders) when something changed.
    function refreshView(): void {
      if (!props.scrollbar) return
      const viewportHeight = rectContentHeight(viewport.value)
      const contentHeight = viewportHeight + maxScroll()
      const y = current()
      const v = view.value
      if (v.y !== y || v.viewportHeight !== viewportHeight || v.contentHeight !== contentHeight) {
        view.value = { y, viewportHeight, contentHeight }
      }
    }

    function apply(value: number): void {
      const max = maxScroll()
      const next = clamp(value, max)
      // A real offset change marks this as a user scroll (wheel/keys/scrollbar-drag
      // all flow through here). The stick-to-bottom auto-pin writes scrollY directly
      // in `syncScroll` and never reaches `apply`, so it can't trip this. In
      // controlled mode a parent-driven prop reassignment also routes through here
      // but with `next === current()` (both read the new prop), so it's treated as
      // non-user and intentionally does NOT clear — only user gestures invalidate.
      const moved = next !== current()
      localScrollY = next
      // At (or below) the last row → re-pin; scrolled up → release the pin.
      if (props.stickToBottom) stuck = next >= max
      if (viewport.value) {
        viewport.value.scrollY = next
        viewport.value.markDirty()
      }
      emit('update:modelValue', next)
      emit('update:scrollY', next)
      emit('scroll', next)
      // Drop an active selection on a genuine user scroll — its screen-absolute
      // coords would otherwise highlight the wrong glyphs once content moves.
      if (moved) viewport.value?.ctx.invalidateSelection?.()
      refreshView()
      viewport.value?.ctx.scheduleRender()
    }

    function scrollBy(delta: number): void {
      apply(current() + delta)
    }

    // Let a parent drive scrolling (e.g. PgUp/PgDn forwarded while another element
    // holds focus) WITHOUT binding scrollY — so uncontrolled stick-to-bottom keeps
    // owning the auto-follow. `scrollToBottom` jumps to the max and re-engages stick.
    expose({
      scrollBy,
      scrollToBottom: (): void => apply(maxScroll()),
    })

    // After layout (rects fresh), pin to the new bottom when stuck, or re-clamp a
    // stale offset when content shrank/resized. Uncontrolled only — a bound
    // scrollY/modelValue owns the offset, so leave it alone. No scheduleRender:
    // paint runs immediately after this in the same frame.
    function syncScroll(): void {
      const vp = viewport.value
      if (!vp || currentProp() !== undefined) {
        refreshView()
        return
      }
      const max = maxScroll()
      const target = props.stickToBottom && stuck ? max : clamp(localScrollY, max)
      if (vp.scrollY !== target || localScrollY !== target) {
        localScrollY = target
        vp.scrollY = target
        vp.markDirty()
      }
      refreshView()
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type === 'key') {
        const page = props.pageStep ?? Math.max(1, rectContentHeight(viewport.value) - 1)
        const step = Math.max(1, Math.floor(props.step))
        const keys: Record<string, number> = {
          up: -step,
          down: step,
          pageUp: -page,
          pageDown: page,
          home: -current(),
          end: maxScroll() - current(),
        }
        const delta = keys[ev.name]
        if (delta !== undefined) {
          ev.preventDefault()
          scrollBy(delta)
          return
        }
      }
      // Not a scroll key: forward to the consumer's @keyDown (the component box
      // owns onKeyDown, so without this the consumer handler would be swallowed).
      ;(attrs.onKeyDown as ((ev: DispatchableEvent) => void) | undefined)?.(ev)
    }

    function onWheel(ev: DispatchableMouseEvent): void {
      if (ev.type === 'mouse' && ev.kind === 'wheel') {
        ev.preventDefault()
        scrollBy(ev.button === 'wheelUp' ? -props.step : props.step)
        return
      }
      ;(attrs.onWheel as ((ev: DispatchableMouseEvent) => void) | undefined)?.(ev)
    }

    watch(
      () => currentProp(),
      (value) => {
        if (value !== undefined) apply(value)
      },
    )

    onMounted(() => {
      // The template ref binds during the patch, not synchronously in onMounted on
      // this host renderer — defer to the next tick so `viewport.value` exists.
      void nextTick(() => {
        viewport.value?.ctx.afterLayout.add(syncScroll)
        if (props.stickToBottom) {
          stuck = true
          syncScroll() // pin to the bottom on first layout
          viewport.value?.ctx.scheduleRender()
        } else {
          apply(current())
        }
      })
    })

    onUnmounted(() => {
      viewport.value?.ctx.afterLayout.delete(syncScroll)
    })

    return () => {
      const y = current()
      // The scrolling viewport: clips + culls its children (boxes default to
      // overflow `visible`, so the scroll-box opts into clipping).
      if (!props.scrollbar) {
        return h(
          'box',
          {
            flexDirection: 'column',
            alignItems: 'stretch',
            ...attrs,
            ref: viewport,
            overflow: 'scroll',
            focusable: props.focusable,
            focused: props.focused,
            scrollY: y,
            onKeyDown,
            onWheel,
          },
          slots.default?.(),
        )
      }
      // Integrated scrollbar. The outer box MUST stay a row (content | bar). Flow
      // attrs (flexDirection/gap/padding/justify/…) describe the scrolling CONTENT,
      // so they go on the inner viewport — not the wrapper. Only sizing/frame attrs
      // (width/height/min/max/border/flex) size the outer frame. If a consumer's
      // `flexDirection: 'column'` reached the wrapper it would stack the full-height
      // bar BELOW the content, doubling the height and shoving the following
      // siblings (composer, status bar, …) off-screen.
      const {
        width,
        height,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        border,
        flexGrow,
        flexShrink,
        flexBasis,
        ...flow
      } = attrs as Record<string, unknown>
      const frame: Record<string, unknown> = {
        width,
        height,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        border,
        flexGrow,
        flexShrink,
        flexBasis,
      }
      for (const key of Object.keys(frame)) if (frame[key] === undefined) delete frame[key]
      const content = h(
        'box',
        {
          flexDirection: 'column',
          ...flow,
          alignItems: 'stretch',
          flexGrow: 1,
          // Let the viewport shrink to the width the wrapper hands it (bar excluded)
          // instead of its content's intrinsic width. Without this, a long line's
          // min-content width inflates the viewport, so text never wraps and the
          // bar gets squeezed off the right edge.
          minWidth: 0,
          ref: viewport,
          overflow: 'scroll',
          focusable: props.focusable,
          focused: props.focused,
          scrollY: y,
          onKeyDown,
          onWheel,
        },
        slots.default?.(),
      )
      const v = view.value
      return h('box', { ...frame, flexDirection: 'row', alignItems: 'stretch' }, [
        content,
        h(VuiScrollBar, {
          scrollY: v.y,
          viewportHeight: v.viewportHeight,
          contentHeight: v.contentHeight,
          'onUpdate:scrollY': (next: number) => apply(next),
        }),
      ])
    }
  },
})
