// `VuiDialogAlert` — a one-message acknowledgement modal. Title + body text + a
// hint line; Enter / Space / Esc all dismiss it. Built on `VuiDialog` with the
// panel auto-focused (no separate control), so the base handles Esc and the
// dialog handles Enter/Space.
import { defineComponent, h } from '@vue/runtime-core'
import { type DispatchableEvent, useTheme } from '@vui-rs/vue'
import { VuiDialog } from './dialog.ts'

export const VuiDialogAlert = defineComponent({
  name: 'VuiDialogAlert',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: 'Alert' },
    message: { type: String, default: '' },
    okLabel: { type: String, default: 'OK' },
  },
  emits: ['update:open', 'close'],
  setup(props, { emit }) {
    const theme = useTheme()

    function close(): void {
      emit('update:open', false)
      emit('close')
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== 'key') return
      if (ev.name === 'enter' || ev.name === 'space') {
        ev.preventDefault()
        close()
      }
    }

    return () =>
      h(
        VuiDialog,
        {
          open: props.open,
          title: props.title,
          size: 'small',
          'onUpdate:open': (v: boolean) => emit('update:open', v),
          onClose: () => emit('close'),
          onKeyDown,
        },
        () => [
          h('text', { fg: theme.text, wrap: 'word' }, props.message),
          h('text', {}, ' '),
          h('text', { fg: theme.textMuted }, [
            h('span', { fg: theme.primary, bold: true }, 'Enter'),
            ` ${props.okLabel}`,
          ]),
        ],
      )
  },
})
