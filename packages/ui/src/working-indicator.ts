// `VuiWorkingIndicator` — a busy → done status line. While `done` is false it
// shows an engine-driven `<VuiSpinner>` (Phase 04) plus a label; once `done` flips
// true it swaps to a check + the done label and the spinner's tween stops (the
// spinner unmounts), so an idle app returns to zero-render-on-idle. This is the
// "working indicator" an agent CLI shows next to a running tool call.
import { type PropType, defineComponent, h } from '@vue/runtime-core'
import { VuiSpinner, type SpinnerPreset, useTheme } from '@vui-rs/vue'

type ColorProp = string | number

export const VuiWorkingIndicator = defineComponent({
  name: 'VuiWorkingIndicator',
  props: {
    label: { type: String, default: 'Working…' },
    done: { type: Boolean, default: false },
    doneLabel: { type: String, default: 'Done' },
    preset: { type: String as PropType<SpinnerPreset>, default: 'braille' },
    /** Spinner / check color; defaults to theme accent (busy) / success (done). */
    color: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    /** Glyph shown when done. */
    doneGlyph: { type: String, default: '✔' },
  },
  setup(props) {
    const theme = useTheme()
    return () => {
      if (props.done) {
        return h('text', { fg: props.color ?? theme.success }, [
          h('span', { bold: true }, `${props.doneGlyph} `),
          props.doneLabel,
        ])
      }
      return h(VuiSpinner, {
        preset: props.preset,
        color: props.color ?? theme.accent,
        label: props.label,
      })
    }
  },
})
