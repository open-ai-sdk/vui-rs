// `useElementRect` — track a vui element's absolute screen rect reactively. Point
// it at a template ref (`const anchor = ref(); <box :ref="anchor">`) and read back
// a `{ x, y, width, height }` in terminal cells. The anchor-tracking primitive
// behind anchored popups (the autocomplete overlay opens above its input).
//
// Re-measures on every pass that RECOMPUTES layout — terminal resize, content
// reflow, a dock/sibling appearing or resizing. It is NOT driven by paint-only
// scroll offsets: scrolling an ancestor (which moves the element on screen without
// a relayout) does not refresh the rect, so anchor an element that is a sibling of
// any scroll viewport, not a descendant of one. Event-driven off the layout pass
// (no polling); writes the ref only when the rounded rect actually changes, so a
// popup whose size depends on the rect can't drive a re-measure loop.
import { type Ref, getCurrentScope, inject, onScopeDispose, shallowRef } from '@vue/runtime-core'
import { getScreenRect, type ScreenMeasure } from './host/measure.ts'
import { HostContextSymbol, Renderable } from './host/renderable.ts'

export type { ScreenMeasure } from './host/measure.ts'

/**
 * The host `Renderable` a template ref resolves to. An element ref (`<box :ref>`)
 * binds the host node directly; a component ref may wrap it as `$el`. Anything
 * else (a stale `null`, a plain expose object) yields no node.
 */
function resolveRenderable(value: unknown): Renderable | null {
  if (value instanceof Renderable) return value
  const el = (value as { $el?: unknown } | null)?.$el
  return el instanceof Renderable ? el : null
}

function sameRect(a: ScreenMeasure | null, b: ScreenMeasure | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Reactive screen rect for the element `elRef` points at, or `null` before its
 * first layout (or once unmounted). Subscribes to the host's layout tick and
 * re-measures on each pass that moved anything; unsubscribes when the owning
 * effect scope disposes. Must be called in a component `setup()` (it injects the
 * host context and registers a scope-dispose hook).
 */
export function useElementRect(elRef: Ref<unknown>): Readonly<Ref<ScreenMeasure | null>> {
  const rect = shallowRef<ScreenMeasure | null>(null)
  const ctx = inject(HostContextSymbol, null)

  function remeasure(): void {
    const node = resolveRenderable(elRef.value)
    const next = node ? getScreenRect(node) : null
    if (!sameRect(rect.value, next)) rect.value = next
  }

  if (ctx) {
    ctx.layoutListeners.add(remeasure)
    if (getCurrentScope()) onScopeDispose(() => ctx.layoutListeners.delete(remeasure))
    // The element ref binds during the mount patch, after this runs — measure once
    // the first layout pass fires (the listener above), and again on every move.
  }

  return rect
}
