// `<VuiHostInput>` — the JS-host `<input>` binding. The twin of the FFI host's
// `VuiInput`, but editing runs through the JS edit model on `EditRenderable`
// (the FFI one drove the native `vui_edit_*`). Key events (delivered by the host
// focus manager) forward to the edit ops; the value reads back to drive v-model.
// `v-model` is `value`/`update:value`. Visual/layout props fall through to the
// `<input>` host element.
import { type PropType, defineComponent, h, shallowRef, watch } from '@vue/runtime-core'
import { EditMotion } from '@vui-rs/core'
import { type EditRenderable } from '../edit-renderable.ts'
import { type DispatchableEvent } from '../focus.ts'

type ColorProp = string | number

export const VuiHostInput = defineComponent({
  name: 'VuiHostInput',
  props: {
    value: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    placeholderColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    cursorColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    maxLength: { type: Number, default: undefined },
    tabBehavior: { type: String as PropType<'focus' | 'capture'>, default: undefined },
    focused: { type: Boolean, default: false },
  },
  emits: ['update:value', 'input', 'change', 'enter'],
  setup(props, { emit }) {
    const el = shallowRef<EditRenderable>()
    let lastEmitted = props.value
    let lastChanged = props.value

    const edit = (): EditRenderable | undefined => el.value

    // Apply the initial value once the host element exists. Focus is NOT set
    // here — `focused` is forwarded to the host element below so the focus
    // manager (via patch-prop) tracks it reactively, including later changes
    // (e.g. a dialog closing and the input regaining focus). Setting it only on
    // mount made `:focused` write-once, so re-focus after an overlay closed
    // never happened and the input went dead until a manual click.
    watch(el, (node) => {
      if (!node) return
      node.setValue(props.value)
      lastEmitted = lastChanged = props.value
    })

    // External v-model writes: push in only when they differ (skip our own echo).
    watch(
      () => props.value,
      (v) => {
        const e = edit()
        if (!e || v === e.getValue()) return
        e.setValue(v)
        lastEmitted = lastChanged = v
        e.ctx.scheduleRender()
      },
    )

    function surface(): string {
      const value = edit()!.getValue()
      if (value !== lastEmitted) {
        lastEmitted = value
        emit('update:value', value)
        emit('input', value)
      }
      edit()?.ctx.scheduleRender()
      return value
    }

    function onKeyDown(ev: DispatchableEvent): void {
      const e = edit()
      if (!e || ev.type !== 'key') return
      let handled = true
      switch (ev.name) {
        case 'left':
          e.move(ev.ctrl || ev.alt ? EditMotion.WordLeft : EditMotion.Left)
          break
        case 'right':
          e.move(ev.ctrl || ev.alt ? EditMotion.WordRight : EditMotion.Right)
          break
        case 'home':
          e.move(EditMotion.Home)
          break
        case 'end':
          e.move(EditMotion.End)
          break
        case 'backspace':
          e.backspace()
          break
        case 'delete':
          e.delete()
          break
        case 'enter': {
          const value = e.getValue()
          if (value !== lastChanged) {
            lastChanged = value
            emit('change', value)
          }
          emit('enter', value)
          break
        }
        default:
          if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
      }
      if (handled) {
        ev.preventDefault()
        if (ev.name !== 'enter') surface()
      }
    }

    function onPaste(ev: DispatchableEvent): void {
      const e = edit()
      if (!e || ev.type !== 'paste') return
      e.insert(ev.text)
      ev.preventDefault()
      surface()
    }

    function onBlur(): void {
      const value = edit()?.getValue()
      if (value !== undefined && value !== lastChanged) {
        lastChanged = value
        emit('change', value)
      }
    }

    return () =>
      h('input', {
        ref: el,
        // Sensible defaults so a bare `<VuiInput>` is visible without the caller
        // sizing it (the `<input>` element has no intrinsic size — like `<text>`).
        // A caller's fallthrough width/height is merged on top and overrides these.
        width: { pct: 1 },
        height: 1,
        focusable: true,
        // Forward `focused` so patch-prop drives the focus manager reactively
        // (focus on true, blur on false) — not just once at mount.
        focused: props.focused,
        placeholder: props.placeholder,
        placeholderColor: props.placeholderColor,
        cursorColor: props.cursorColor,
        maxLength: props.maxLength,
        tabBehavior: props.tabBehavior,
        onKeyDown,
        onPaste,
        onBlur,
      })
  },
})

/** A bare printable key (single grapheme, no ctrl/alt/meta) — text to insert. */
function isPrintable(ev: DispatchableEvent): boolean {
  return ev.type === 'key' && !ev.ctrl && !ev.alt && !ev.meta && ev.name >= ' ' && [...ev.name].length === 1
}
