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
import { inject, onUnmounted, watch } from "@vue/runtime-core";
import { HostContextSymbol, type Renderable } from "@vui-rs/vue";

/**
 * Capture/restore focus around a modal's open state. Pass a reactive getter for
 * whether the modal is open; when it flips false (or the component unmounts) the
 * previously focused node is re-focused.
 */
export function useFocusTrap(isOpen: () => boolean): void {
  const ctx = inject(HostContextSymbol, null);
  let previouslyFocused: Renderable | null = null;

  function restore(): void {
    const fm = ctx?.focusManager;
    if (fm) {
      // Re-focus the prior node, or — if the modal opened with nothing focused —
      // blur, so the manager's `current` doesn't dangle on the modal's now-
      // unmounted control (it isn't released elsewhere on teardown).
      if (previouslyFocused) fm.focus(previouslyFocused);
      else fm.blur();
    }
    previouslyFocused = null;
  }

  watch(
    isOpen,
    (open, wasOpen) => {
      if (open && !wasOpen) {
        previouslyFocused = ctx?.focusManager?.current() ?? null;
      } else if (!open && wasOpen) {
        restore();
      }
    },
    { immediate: true },
  );

  onUnmounted(restore);
}
