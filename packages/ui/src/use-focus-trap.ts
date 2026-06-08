// `useFocusTrap` — the focus bookkeeping a modal needs around its open/close
// lifecycle. The *confinement* (Tab/Shift-Tab staying inside the modal) is done by
// the host focus manager itself once the overlay carries `trapFocus` — see
// `focus.ts`'s `order()`. This composable handles the two remaining concerns:
//
//   1. Remember which node had focus when the modal opened, and
//   2. Restore focus to it when the modal closes (or the component unmounts),
//
// so dismissing a dialog returns the user to wherever they were. Autofocus *into*
// the modal is each dialog's own job (its primary control renders `focused`), which
// is more precise than guessing a first-focusable here.
import { inject, onUnmounted, watch } from '@vue/runtime-core'
import { HostContextSymbol, type Renderable } from '@vui-rs/vue'

/**
 * Capture/restore focus around a modal's open state. Pass a reactive getter for
 * whether the modal is open; when it flips false (or the component unmounts) the
 * previously focused node is re-focused.
 */
export function useFocusTrap(isOpen: () => boolean): void {
  const ctx = inject(HostContextSymbol, null)
  let previouslyFocused: Renderable | null = null

  function restore(): void {
    // Re-focus the node that was focused before the modal opened. If there was
    // none, do NOT blur: the modal's own focusable control is released on unmount
    // (node-ops `remove` → focusManager.release), so `current` is already cleared.
    // Blurring here would instead stomp a consumer that reactively re-focuses its
    // own control as the modal closes (e.g. a composer whose `:focused` flips back
    // to true in the same flush) — the dialog's unmount runs last and would undo it.
    if (previouslyFocused) ctx?.focusManager?.focus(previouslyFocused)
    previouslyFocused = null
  }

  watch(
    isOpen,
    (open, wasOpen) => {
      if (open && !wasOpen) {
        previouslyFocused = ctx?.focusManager?.current() ?? null
      } else if (!open && wasOpen) {
        restore()
      }
    },
    { immediate: true },
  )

  onUnmounted(restore)
}
