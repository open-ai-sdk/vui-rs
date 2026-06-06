// `VuiDialogSelect` — a fuzzy-search picker modal (the "command-k list" pattern).
// A focused search input filters/ranks the items via `fuzzyFilter`; matched
// characters are highlighted. Up/Down (and PageUp/PageDown) move the active row
// (kept in view in a culling `<VuiScrollBox>`), Enter selects it, Esc cancels;
// Home/End edit the search text (the input owns them). Items may carry a `group`
// (header shown when not searching) and a `hint` (right-aligned, e.g. a keybind).
// Built on `VuiDialog` with `autofocus=false` (the input owns focus); the nav keys
// the input leaves unhandled bubble from it to the wrapper box.
import { type PropType, computed, defineComponent, h, ref, watch } from '@vue/runtime-core'
import { type DispatchableEvent, VuiInput, VuiScrollBox, useTheme } from '@vui-rs/vue'
import { VuiDialog } from './dialog.ts'
import { fuzzyFilter } from './fuzzy.ts'

export interface SelectOption {
  label: string
  value: string | number
  group?: string
  hint?: string
}
type OptionInput = SelectOption | string

function normalize(o: OptionInput): SelectOption {
  return typeof o === 'string' ? { label: o, value: o } : o
}

export const VuiDialogSelect = defineComponent({
  name: 'VuiDialogSelect',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: 'Select' },
    items: { type: Array as PropType<OptionInput[]>, default: () => [] },
    placeholder: { type: String, default: 'Search…' },
    /** Max rows of the scrolling list viewport. */
    maxRows: { type: Number, default: 10 },
  },
  emits: ['update:open', 'select', 'close'],
  setup(props, { emit }) {
    const theme = useTheme()
    const query = ref('')
    const active = ref(0)
    const scrollY = ref(0)

    const options = computed(() => props.items.map(normalize))
    // Ranked matches; an empty query is an identity filter (original order).
    const ranked = computed(() => fuzzyFilter(query.value, options.value, (o) => o.label))
    const searching = computed(() => query.value.length > 0)

    watch(
      () => props.open,
      (open) => {
        if (open) {
          query.value = ''
          active.value = 0
          scrollY.value = 0
        }
      },
    )
    // Filtering can shrink the list under the cursor — clamp the active row.
    watch(ranked, (r) => {
      if (active.value > r.length - 1) active.value = Math.max(0, r.length - 1)
    })
    // Keep the active row inside the viewport window.
    watch([active, () => props.maxRows], ([a, rows]) => {
      if (a < scrollY.value) scrollY.value = a
      else if (a >= scrollY.value + rows) scrollY.value = a - rows + 1
    })

    function move(delta: number): void {
      const n = ranked.value.length
      if (n === 0) return
      active.value = (active.value + delta + n) % n
    }

    function commit(): void {
      const hit = ranked.value[active.value]
      if (!hit) return
      emit('select', hit.item.value, hit.item)
      emit('update:open', false)
      emit('close')
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== 'key') return
      // Only the keys the input leaves unhandled reach here: it consumes Home/End
      // (cursor) and the printable keys (filtering), but ignores arrows/page keys.
      switch (ev.name) {
        case 'up':
          ev.preventDefault()
          move(-1)
          break
        case 'down':
          ev.preventDefault()
          move(1)
          break
        case 'pageUp':
          ev.preventDefault()
          active.value = Math.max(0, active.value - props.maxRows)
          break
        case 'pageDown':
          ev.preventDefault()
          active.value = Math.min(ranked.value.length - 1, active.value + props.maxRows)
          break
      }
    }

    // Render a label with its fuzzy-matched characters emphasised.
    function labelSpans(label: string, indices: number[], on: boolean) {
      if (indices.length === 0) return [label]
      const set = new Set(indices)
      const spans = []
      for (let i = 0; i < label.length; i++) {
        const hit = set.has(i)
        spans.push(h('span', { fg: hit ? (on ? theme.selectedText : theme.primary) : undefined, bold: hit }, label[i]))
      }
      return spans
    }

    function rows() {
      const out = []
      let lastGroup: string | undefined
      ranked.value.forEach((r, i) => {
        const opt = r.item
        if (!searching.value && opt.group && opt.group !== lastGroup) {
          lastGroup = opt.group
          out.push(h('text', { key: `g:${opt.group}`, fg: theme.textMuted, bold: true }, opt.group))
        }
        const on = i === active.value
        out.push(
          h(
            'box',
            {
              key: `i:${opt.value}`,
              flexDirection: 'row',
              justifyContent: 'space-between',
              bg: on ? theme.primary : undefined,
              onMouseDown: (ev: DispatchableEvent) => {
                ev.preventDefault()
                active.value = i
                commit()
              },
            },
            [
              h('text', { fg: on ? theme.selectedText : theme.text }, labelSpans(opt.label, r.indices, on)),
              opt.hint ? h('text', { fg: on ? theme.selectedText : theme.textMuted }, opt.hint) : null,
            ],
          ),
        )
      })
      if (out.length === 0) out.push(h('text', { fg: theme.textMuted }, 'No matches'))
      return out
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
        () => [
          h(
            'box',
            {
              border: 'rounded',
              borderColor: theme.border,
              padding: { left: 1, right: 1 },
              // Up/Down/Home/End aren't consumed by the input, so they bubble here
              // for list navigation; printable keys stay with the input.
              onKeyDown,
            },
            h(VuiInput, {
              value: query.value,
              placeholder: props.placeholder,
              focused: true,
              cursorColor: theme.primary,
              'onUpdate:value': (v: string) => {
                query.value = v
                active.value = 0
              },
              onEnter: commit,
            }),
          ),
          h(
            VuiScrollBox,
            {
              scrollY: scrollY.value,
              maxHeight: props.maxRows,
              focusable: false,
              'onUpdate:scrollY': (y: number) => (scrollY.value = y),
            },
            { default: rows },
          ),
        ],
      )
  },
})
