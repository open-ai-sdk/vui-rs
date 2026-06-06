// Fixed chrome regions around the main view — the status bar / header / footer an
// editor keeps pinned. `VuiStatusBar` is the core: a full-width, theme-coloured
// row with three slots — `left`, `center`,
// `right` — flex-spread across it. Any slot can hold an arbitrary widget (a
// spinner, a mode badge, a keybind hint), so the "widget slot" is just a named
// slot. `VuiHeader`/`VuiFooter` are semantic presets of the same row. These don't
// pin themselves to the screen — place them as the first/last child of a
// column-flex root so they bracket a flex-grow content area.
import { type PropType, defineComponent, h } from '@vue/runtime-core'
import { useTheme } from '@vui-rs/vue'

type ColorProp = string | number

export const VuiStatusBar = defineComponent({
  name: 'VuiStatusBar',
  props: {
    height: { type: Number, default: 1 },
    bg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    fg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    /** Horizontal padding inside the bar. */
    pad: { type: Number, default: 1 },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    return () =>
      h(
        'box',
        {
          width: { pct: 1 },
          height: props.height,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          bg: props.bg ?? theme.backgroundPanel,
          fg: props.fg ?? theme.textMuted,
          padding: { left: props.pad, right: props.pad },
        },
        [
          h('box', { flexDirection: 'row', alignItems: 'center', gap: 1 }, slots.left?.()),
          h('box', { flexDirection: 'row', alignItems: 'center', gap: 1 }, slots.center?.() ?? slots.default?.()),
          h('box', { flexDirection: 'row', alignItems: 'center', gap: 1 }, slots.right?.()),
        ],
      )
  },
})

/** A header row: a status bar with the active-border accent by default. */
export const VuiHeader = defineComponent({
  name: 'VuiHeader',
  props: {
    bg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    fg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    return () => h(VuiStatusBar, { bg: props.bg ?? theme.backgroundElement, fg: props.fg ?? theme.text }, slots)
  },
})

/** A footer row — alias of the status bar with footer-typical muted styling. */
export const VuiFooter = defineComponent({
  name: 'VuiFooter',
  setup(_props, { slots }) {
    return () => h(VuiStatusBar, null, slots)
  },
})
