// `VuiDialogPrompt` — a single-line text-entry modal. Title + optional message +
// a focused `<VuiInput>` + optional inline validation. Enter submits when valid
// (emits `submit` with the trimmed-or-raw value), Esc cancels (bubbles to the
// base dialog). A `validate` fn returns an error string (shown in red) or null to
// allow submission. Built on `VuiDialog` with `autofocus=false` — the input owns
// focus while the panel still catches Esc via bubbling.
import { type PropType, computed, defineComponent, h, ref, watch } from '@vue/runtime-core'
import { VuiInput, useTheme } from '@vui-rs/vue'
import { VuiDialog } from './dialog.ts'

export const VuiDialogPrompt = defineComponent({
  name: 'VuiDialogPrompt',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: 'Input' },
    message: { type: String, default: '' },
    /** Initial / v-model text value. */
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    /** Returns an error message to block submit, or null/empty to allow it. */
    validate: { type: Function as PropType<(v: string) => string | null>, default: undefined },
  },
  emits: ['update:open', 'update:modelValue', 'submit', 'close'],
  setup(props, { emit }) {
    const theme = useTheme()
    const text = ref(props.modelValue)

    // Reset to the provided value each time the dialog reopens.
    watch(
      () => props.open,
      (open) => {
        if (open) text.value = props.modelValue
      },
    )

    const error = computed(() => props.validate?.(text.value) ?? null)

    function onInput(v: string): void {
      text.value = v
      emit('update:modelValue', v)
    }

    function submit(): void {
      if (error.value) return // invalid — keep the dialog open
      emit('submit', text.value)
      emit('update:open', false)
      emit('close')
    }

    return () =>
      h(
        VuiDialog,
        {
          open: props.open,
          title: props.title,
          size: 'medium',
          autofocus: false,
          'onUpdate:open': (v: boolean) => emit('update:open', v),
          onClose: () => emit('close'),
        },
        () => {
          const rows = []
          if (props.message) {
            rows.push(h('text', { fg: theme.text, wrap: 'word' }, props.message))
            rows.push(h('text', {}, ' '))
          }
          rows.push(
            h(
              'box',
              {
                border: 'rounded',
                borderColor: error.value ? theme.error : theme.border,
                padding: { left: 1, right: 1 },
              },
              h(VuiInput, {
                value: text.value,
                placeholder: props.placeholder,
                focused: true,
                cursorColor: theme.primary,
                'onUpdate:value': onInput,
                onEnter: submit,
              }),
            ),
          )
          rows.push(
            error.value
              ? h('text', { fg: theme.error }, props.validate ? error.value : '')
              : h('text', { fg: theme.textMuted }, [
                  h('span', { fg: theme.primary, bold: true }, 'Enter'),
                  ' submit · ',
                  h('span', { fg: theme.primary, bold: true }, 'Esc'),
                  ' cancel',
                ]),
          )
          return rows
        },
      )
  },
})
