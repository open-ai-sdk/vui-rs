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

/**
 * Payload for the component-level `@paste` event emitted by `<input>`/`<textarea>`.
 * A consumer may inspect `text` (one atomic bracketed-paste payload) and call
 * `preventDefault()` to suppress the default insert-into-buffer — e.g. to turn a
 * dragged file path into an attachment instead of typed text. Without a listener,
 * or when `preventDefault()` is not called, the text is inserted as before.
 */
export interface HostPasteEvent {
  /** The pasted text. */
  readonly text: string
  /** Suppress the default insert of `text` into the edit buffer. */
  preventDefault(): void
  /** Whether `preventDefault()` has been called. */
  readonly defaultPrevented: boolean
}

/** Build a `HostPasteEvent` over `text`; the returned `prevented()` reads the cancel state after emit. */
export function makeHostPasteEvent(text: string): { event: HostPasteEvent; prevented: () => boolean } {
  let prevented = false
  const event: HostPasteEvent = {
    text,
    preventDefault() {
      prevented = true
    },
    get defaultPrevented() {
      return prevented
    },
  }
  return { event, prevented: () => prevented }
}

export const VuiHostInput = defineComponent({
  name: 'VuiHostInput',
  props: {
    value: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    placeholderColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    cursorColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    /**
     * Block-cursor blink. `true`/unset blinks at the default rate, `false` keeps a
     * steady (non-blinking) cursor, a number sets a custom half-period in ms.
     */
    cursorBlink: { type: [Boolean, Number] as PropType<boolean | number>, default: undefined },
    maxLength: { type: Number, default: undefined },
    tabBehavior: { type: String as PropType<'focus' | 'capture'>, default: undefined },
    ctrlCBehavior: { type: String as PropType<'exit' | 'capture'>, default: undefined },
    focused: { type: Boolean, default: false },
  },
  emits: ['update:value', 'input', 'change', 'enter', 'paste'],
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
          // Ctrl/Alt+Backspace delete the previous word (readline); plain deletes a char.
          if (ev.ctrl || ev.alt) e.deleteWordLeft()
          else e.backspace()
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
        // readline line-editing: Ctrl+U (to start), Ctrl+W (word back), Ctrl+K (to end).
        case 'u':
          if (ev.ctrl && !ev.alt && !ev.meta) e.deleteToStart()
          else handled = insertPrintable(e, ev)
          break
        case 'w':
          if (ev.ctrl && !ev.alt && !ev.meta) e.deleteWordLeft()
          else handled = insertPrintable(e, ev)
          break
        case 'k':
          if (ev.ctrl && !ev.alt && !ev.meta) e.deleteToEnd()
          else handled = insertPrintable(e, ev)
          break
        default:
          handled = insertPrintable(e, ev)
      }
      if (handled) {
        ev.preventDefault()
        if (ev.name !== 'enter') surface()
      }
    }

    function onPaste(ev: DispatchableEvent): void {
      const e = edit()
      if (!e || ev.type !== 'paste') return
      // Always consume the host paste here (don't let it bubble); we own insertion.
      ev.preventDefault()
      // Offer the paste to the consumer first: they may turn it into an attachment
      // and cancel the default insert. No listener / no cancel → insert as before.
      const { event, prevented } = makeHostPasteEvent(ev.text)
      emit('paste', event)
      if (prevented()) return
      e.insert(ev.text)
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
        cursorBlink: props.cursorBlink,
        maxLength: props.maxLength,
        tabBehavior: props.tabBehavior,
        ctrlCBehavior: props.ctrlCBehavior,
        onKeyDown,
        onPaste,
        onBlur,
      })
  },
})

/** A bare printable key (single grapheme, no ctrl/alt/meta) — text to insert. */
function isPrintable(ev: DispatchableEvent): ev is DispatchableEvent & { name: string } {
  return ev.type === 'key' && !ev.ctrl && !ev.alt && !ev.meta && ev.name >= ' ' && [...ev.name].length === 1
}

/** Insert a printable key; returns whether it was handled (so the caller can let others bubble). */
function insertPrintable(e: EditRenderable, ev: DispatchableEvent): boolean {
  if (!isPrintable(ev)) return false
  e.insert(ev.name)
  return true
}
