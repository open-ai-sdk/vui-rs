import { computed, defineComponent, h, onUnmounted, shallowRef } from '@vue/runtime-core'
import type { DispatchableMouseEvent } from '../focus.ts'
import type { Renderable } from '../renderable.ts'

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, Math.floor(max))))
}

export const VuiScrollBar = defineComponent({
  name: 'VuiScrollBar',
  inheritAttrs: false,
  props: {
    scrollY: { type: Number, default: 0 },
    viewportHeight: { type: Number, required: true },
    contentHeight: { type: Number, required: true },
    thumbBg: { type: [String, Number], default: 'white' },
    trackBg: { type: [String, Number], default: undefined },
  },
  emits: ['update:scrollY', 'scroll'],
  setup(props, { attrs, emit }) {
    const track = shallowRef<Renderable>()
    let dragStartY: number | null = null
    let dragStartScroll = 0

    const maxScroll = computed(() => Math.max(0, Math.round(props.contentHeight - props.viewportHeight)))
    const thumbHeight = computed(() => {
      if (props.contentHeight <= 0) return Math.max(1, Math.round(props.viewportHeight))
      return Math.max(1, Math.round((props.viewportHeight / props.contentHeight) * props.viewportHeight))
    })
    const thumbTop = computed(() => {
      const travel = Math.max(0, Math.round(props.viewportHeight - thumbHeight.value))
      if (maxScroll.value <= 0) return 0
      return clamp((props.scrollY / maxScroll.value) * travel, travel)
    })

    function emitScroll(value: number): void {
      const next = clamp(value, maxScroll.value)
      emit('update:scrollY', next)
      emit('scroll', next)
      track.value?.ctx.scheduleRender()
    }

    function scrollForPointer(y: number): number {
      const top = track.value?.screenRect?.y0 ?? 0
      const travel = Math.max(1, Math.round(props.viewportHeight - thumbHeight.value))
      const relative = clamp(y - top - Math.floor(thumbHeight.value / 2), travel)
      return (relative / travel) * maxScroll.value
    }

    function onMouseDown(ev: DispatchableMouseEvent): void {
      if (ev.type !== 'mouse' || ev.button !== 'left') return
      ev.preventDefault()
      dragStartY = ev.y
      dragStartScroll = props.scrollY
      // Capture the pointer so the drag keeps tracking even when the cursor leaves
      // the 1-cell-wide track (vertical motion off-column still scrolls).
      if (track.value) track.value.ctx.focusManager?.setPointerCapture(track.value)
      emitScroll(scrollForPointer(ev.y))
    }

    function onMouseMove(ev: DispatchableMouseEvent): void {
      if (ev.type !== 'mouse' || dragStartY == null) return
      ev.preventDefault()
      const travel = Math.max(1, Math.round(props.viewportHeight - thumbHeight.value))
      const delta = ev.y - dragStartY
      emitScroll(dragStartScroll + (delta / travel) * maxScroll.value)
    }

    function onMouseUp(ev: DispatchableMouseEvent): void {
      if (dragStartY == null) return
      ev.preventDefault()
      dragStartY = null
      if (track.value) track.value.ctx.focusManager?.releasePointerCapture(track.value)
    }

    // Belt-and-suspenders: if the bar unmounts mid-drag, don't leave a dangling
    // capture pointed at a freed node.
    onUnmounted(() => {
      if (track.value) track.value.ctx.focusManager?.releasePointerCapture(track.value)
    })

    return () =>
      h(
        'box',
        {
          ...attrs,
          ref: track,
          width: 1,
          height: props.viewportHeight,
          // Clip the absolute thumb to the track: boxes now default to
          // overflow `visible`, so without this the thumb could spill past the
          // track if its geometry ever rounds beyond the travel range.
          overflow: 'hidden',
          bg: props.trackBg,
          onMouseDown,
          onMouseMove,
          onMouseUp,
        },
        // No overflow → nothing to scroll → no thumb. Otherwise a content-fits
        // viewport renders a full-track thumb (default bg `white`), i.e. a solid
        // bright bar that also redraws on every content change (visible flicker).
        maxScroll.value > 0
          ? [
              h('box', {
                position: 'absolute',
                top: thumbTop.value,
                left: 0,
                width: 1,
                height: thumbHeight.value,
                bg: props.thumbBg,
              }),
            ]
          : [],
      )
  },
})
