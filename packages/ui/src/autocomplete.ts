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
//     suggestions with the active row highlighted. With an `anchor` rect (from
//     `useElementRect` on the input) it renders as an overlay popup that opens
//     UPWARD above the anchor — no layout shift, clamped to the space above, and
//     window-scrolled so the active row stays visible. Without an `anchor` it falls
//     back to the original in-flow box just under the input.
import { type PropType, type Ref, computed, defineComponent, h, ref, watch } from '@vue/runtime-core'
import { type DispatchableEvent, type ScreenMeasure, useTheme } from '@vui-rs/vue'

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

/** Rounded border overhead (top+bottom rows / left+right cols). */
const BORDER = 2
const MIN_WIDTH = 20

export const VuiAutocomplete = defineComponent({
  name: 'VuiAutocomplete',
  props: {
    suggestions: { type: Array as PropType<Suggestion[]>, default: () => [] },
    active: { type: Number, default: 0 },
    maxRows: { type: Number, default: 8 },
    /**
     * Screen rect of the input to anchor an upward overlay popup to (from
     * `useElementRect`). Omit / `null` to render in normal flow under the input.
     */
    anchor: { type: Object as PropType<ScreenMeasure | null>, default: null },
    /**
     * Placeholder shown as a single non-interactive row when there are no
     * suggestions (e.g. "No matching items"). Omit to render nothing when empty —
     * so a consumer that mounts the popup only while a trigger is active still gets
     * a "no results" hint without managing it. Back-compat: unset → empty renders
     * nothing, exactly as before.
     */
    emptyText: { type: String as PropType<string | undefined>, default: undefined },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const theme = useTheme()

    // True when there are no suggestions but a placeholder should occupy one row.
    const showEmpty = computed(() => props.suggestions.length === 0 && props.emptyText != null)

    // Rows actually shown. The empty placeholder reserves a single row. In overlay
    // mode also clamp to the space above the anchor (border included) so the popup
    // never overflows the top of the screen.
    const rows = computed(() => {
      const content = showEmpty.value ? 1 : props.suggestions.length
      const wanted = Math.min(props.maxRows, content)
      if (!props.anchor) return wanted
      const fitsAbove = Math.max(0, props.anchor.y - BORDER)
      return Math.min(wanted, fitsAbove)
    })

    // First visible suggestion index. Stateful scroll-into-view: only slides when
    // `active` leaves the current window, keeping the active row visible with
    // minimal movement (a wrap from last→first resets it to the top).
    const windowStart = ref(0)
    watch(
      [() => props.active, rows, () => props.suggestions.length],
      () => {
        const r = rows.value
        const n = props.suggestions.length
        let start = windowStart.value
        if (props.active < start) start = props.active
        else if (props.active >= start + r) start = props.active - r + 1
        // Clamp so the window never runs past the end of the list (or before 0).
        windowStart.value = Math.max(0, Math.min(start, Math.max(0, n - r)))
      },
      { immediate: true },
    )

    const shown = computed(() => props.suggestions.slice(windowStart.value, windowStart.value + rows.value))

    function renderRow(s: Suggestion, i: number) {
      const index = windowStart.value + i
      const on = index === props.active
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
            emit('select', s, index)
          },
        },
        [
          h('text', { fg: on ? theme.selectedText : theme.text }, s.label),
          s.hint ? h('text', { fg: on ? theme.selectedText : theme.textMuted }, s.hint) : null,
        ],
      )
    }

    // Non-interactive placeholder row (no select emit) — opencode's "No matching
    // items" fallback. Muted, single line.
    function renderEmpty() {
      return h('box', { padding: { left: 1, right: 1 } }, [h('text', { fg: theme.textMuted }, props.emptyText)])
    }

    function renderList(extra: Record<string, unknown>) {
      return h(
        'box',
        {
          flexDirection: 'column',
          border: 'rounded',
          borderColor: theme.border,
          bg: theme.backgroundMenu,
          minWidth: MIN_WIDTH,
          ...extra,
        },
        showEmpty.value ? [renderEmpty()] : shown.value.map(renderRow),
      )
    }

    return () => {
      // No suggestions and no placeholder requested → render nothing (back-compat).
      if (props.suggestions.length === 0 && !showEmpty.value) return null
      const anchor = props.anchor
      // In-flow fallback: original behavior, content-sized box under the input.
      if (!anchor) return renderList({ alignSelf: 'flex-start' })

      // Overlay popup: opens upward above the anchor. Hidden when no row fits above
      // (anchor too close to the top edge).
      if (rows.value < 1) return null
      const popupHeight = rows.value + BORDER
      // `rows ≤ anchor.y - BORDER` guarantees `top ≥ 0` — no top-edge overflow.
      const top = anchor.y - popupHeight
      // Full-screen, non-focusing, backdrop-less overlay as a positioning layer;
      // non-content cells fall through to the tree (clicks on the message list keep
      // working), and with no trapFocus the input never loses focus.
      return h('overlay', {}, [
        renderList({
          position: 'absolute',
          top,
          left: anchor.x,
          maxWidth: Math.max(MIN_WIDTH, anchor.width),
        }),
      ])
    }
  },
})
