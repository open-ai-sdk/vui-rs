// `<VuiHostTextarea>` — public `<textarea>` component for SFC/h() authoring.
// It mirrors `<VuiHostInput>`'s v-model contract while delegating multi-line
// editing to `TextareaRenderable`'s native EditBuffer.
import { type PropType, defineComponent, h, shallowRef, watch } from '@vue/runtime-core'
import { EditMotion } from '@vui-rs/core'
import { type DispatchableEvent } from '../focus.ts'
import { type TextareaRenderable } from '../textarea-renderable.ts'

type ColorProp = string | number
let textareaClipboard = ''

export const VuiHostTextarea = defineComponent({
  name: 'VuiHostTextarea',
  props: {
    value: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    placeholderColor: {
      type: [String, Number] as PropType<ColorProp>,
      default: undefined,
    },
    cursorColor: {
      type: [String, Number] as PropType<ColorProp>,
      default: undefined,
    },
    focused: { type: Boolean, default: false },
    wrap: {
      type: String as PropType<'word' | 'char' | 'nowrap'>,
      default: 'word',
    },
    tabBehavior: {
      type: String as PropType<'focus' | 'indent'>,
      default: 'focus',
    },
    tabSize: { type: Number, default: 2 },
  },
  emits: ['update:value', 'input', 'change', 'enter'],
  setup(props, { emit }) {
    const el = shallowRef<TextareaRenderable>()
    let lastEmitted = props.value
    let lastChanged = props.value

    const edit = (): TextareaRenderable | undefined => el.value

    watch(el, (node) => {
      if (!node) return
      node.setValue(props.value)
      lastEmitted = lastChanged = props.value
      if (props.focused) node.ctx.focusManager?.focus(node)
    })

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
          e.move(ev.ctrl || ev.alt ? EditMotion.WordLeft : EditMotion.Left, ev.shift)
          break
        case 'right':
          e.move(ev.ctrl || ev.alt ? EditMotion.WordRight : EditMotion.Right, ev.shift)
          break
        case 'up':
          e.move(EditMotion.Up, ev.shift)
          break
        case 'down':
          e.move(EditMotion.Down, ev.shift)
          break
        case 'home':
          e.move(ev.ctrl || ev.meta ? EditMotion.DocStart : EditMotion.Home, ev.shift)
          break
        case 'end':
          e.move(ev.ctrl || ev.meta ? EditMotion.DocEnd : EditMotion.End, ev.shift)
          break
        case 'backspace':
          e.backspace()
          break
        case 'delete':
          e.delete()
          break
        case 'enter':
          e.newline()
          emit('enter', e.getValue())
          break
        case 'tab':
          if (props.tabBehavior === 'indent') e.insert(' '.repeat(Math.max(1, Math.floor(props.tabSize))))
          else handled = false
          break
        case 'a':
          if (ev.ctrl || ev.meta) e.selectAll()
          else if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
          break
        case 'c':
          if ((ev.ctrl || ev.meta) && e.hasSelection()) {
            textareaClipboard = e.selectedText()
          } else if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
          break
        case 'x':
          if ((ev.ctrl || ev.meta) && e.hasSelection()) {
            textareaClipboard = e.selectedText()
            e.deleteSelection()
          } else if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
          break
        case 'v':
          if ((ev.ctrl || ev.meta) && textareaClipboard) {
            e.insert(textareaClipboard)
          } else if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
          break
        case 'z':
          if (ev.ctrl || ev.meta) {
            if (ev.shift) e.redo()
            else e.undo()
          } else if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
          break
        default:
          if (isPrintable(ev)) e.insert(ev.name)
          else handled = false
      }
      if (handled) {
        ev.preventDefault()
        surface()
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
      h('textarea-host', {
        ref: el,
        focusable: true,
        value: props.value,
        placeholder: props.placeholder,
        placeholderColor: props.placeholderColor,
        cursorColor: props.cursorColor,
        wrap: props.wrap,
        tabBehavior: props.tabBehavior,
        tabSize: props.tabSize,
        onKeyDown,
        onPaste,
        onBlur,
      })
  },
})

function isPrintable(ev: DispatchableEvent): boolean {
  return ev.type === 'key' && !ev.ctrl && !ev.alt && !ev.meta && ev.name >= ' ' && [...ev.name].length === 1
}
