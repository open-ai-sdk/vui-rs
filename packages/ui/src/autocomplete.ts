// Autocomplete — an inline suggestion list under a text input (file/agent/command
// completion, the "@…" / "/…" menus an AI-CLI shows while typing). Two pieces that
// compose with the existing focus model:
//
//   • `useAutocomplete()` — the logic: runs a *stack* of providers against the
//     current query, tracks the active suggestion, and returns `onKeyDown` (wire it
//     on the input's wrapper for Up/Down — those bubble out of the input) plus an
//     `accept()` you call from the input's `@enter` (the input consumes Enter, so it
//     never reaches `onKeyDown`).
//   • `<VuiAutocomplete>` — the presentation: a bordered list of the given
//     suggestions with the active row highlighted, rendered in normal flow right
//     under the input (so it never gets overpainted by following content).
import { type PropType, type Ref, computed, defineComponent, h, ref, watch } from '@vue/runtime-core'
import { type DispatchableEvent, useTheme } from '@vui-rs/vue'

export interface Suggestion {
  label: string
  value: string
  /** Right-aligned secondary text (type, path, etc.). */
  hint?: string
}

/** Produces suggestions for a query. Return `[]` to contribute nothing. */
export type SuggestionProvider = (query: string) => Suggestion[]

export interface AutocompleteOptions {
  query: () => string
  providers: SuggestionProvider[]
  onAccept: (s: Suggestion) => void
  /**
   * Tab handler — completes the active suggestion WITHOUT accepting it (typically
   * "fill the input text" so the user can keep editing). Defaults to `onAccept`
   * when omitted. Reaches the hook only if the focused input opts into receiving
   * Tab (`<input tabBehavior="capture">`); the host otherwise eats Tab for focus
   * traversal.
   */
  onComplete?: (s: Suggestion) => void
  /** Cap the merged suggestion list. */
  max?: number
}

export interface AutocompleteApi {
  suggestions: Ref<Suggestion[]>
  active: Ref<number>
  /** True when there is at least one suggestion to show. */
  visible: Ref<boolean>
  /** Up/Down navigation — wire on the input's wrapper (they bubble out of the input). */
  onKeyDown: (ev: DispatchableEvent) => void
  /** Accept the active suggestion — call from the input's `@enter`. */
  accept: () => void
}

/** Wire provider-stack suggestions + keyboard navigation for an input. */
export function useAutocomplete(opts: AutocompleteOptions): AutocompleteApi {
  const active = ref(0)
  const suggestions = computed<Suggestion[]>(() => {
    const q = opts.query()
    const merged: Suggestion[] = []
    for (const provider of opts.providers) {
      for (const s of provider(q)) {
        merged.push(s)
        if (opts.max && merged.length >= opts.max) return merged
      }
    }
    return merged
  })
  const visible = computed(() => suggestions.value.length > 0)

  // Reset the cursor when the suggestion set changes shape under it.
  watch(suggestions, (s) => {
    if (active.value > s.length - 1) active.value = Math.max(0, s.length - 1)
  })

  function move(delta: number): void {
    const n = suggestions.value.length
    if (n === 0) return
    active.value = (active.value + delta + n) % n
  }

  function accept(): void {
    const s = suggestions.value[active.value]
    if (s) opts.onAccept(s)
  }

  function onKeyDown(ev: DispatchableEvent): void {
    if (ev.type !== 'key' || !visible.value) return
    if (ev.name === 'up') {
      ev.preventDefault()
      move(-1)
    } else if (ev.name === 'down') {
      ev.preventDefault()
      move(1)
    } else if (ev.name === 'tab') {
      // Tab completes the active suggestion (fill text) rather than accepting it.
      ev.preventDefault()
      const s = suggestions.value[active.value]
      if (s) (opts.onComplete ?? opts.onAccept)(s)
    }
  }

  return { suggestions, active, visible, onKeyDown, accept }
}

export const VuiAutocomplete = defineComponent({
  name: 'VuiAutocomplete',
  props: {
    suggestions: { type: Array as PropType<Suggestion[]>, default: () => [] },
    active: { type: Number, default: 0 },
    maxRows: { type: Number, default: 8 },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const theme = useTheme()
    const shown = computed(() => props.suggestions.slice(0, props.maxRows))
    return () => {
      if (props.suggestions.length === 0) return null
      return h(
        'box',
        {
          flexDirection: 'column',
          border: 'rounded',
          borderColor: theme.border,
          bg: theme.backgroundMenu,
          alignSelf: 'flex-start',
          minWidth: 20,
        },
        shown.value.map((s, i) => {
          const on = i === props.active
          return h(
            'box',
            {
              key: s.value,
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 2,
              bg: on ? theme.primary : undefined,
              padding: { left: 1, right: 1 },
              onMouseDown: (ev: DispatchableEvent) => {
                ev.preventDefault()
                emit('select', s, i)
              },
            },
            [
              h('text', { fg: on ? theme.selectedText : theme.text }, s.label),
              s.hint ? h('text', { fg: on ? theme.selectedText : theme.textMuted }, s.hint) : null,
            ],
          )
        }),
      )
    }
  },
})
