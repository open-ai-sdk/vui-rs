// Copy-on-select: the opt-in `copyOnSelect`/`onCopy` host options and the
// clear-after-copy behavior (mouse-up auto-copy + Ctrl+C/Cmd+C). The copy/clear/
// keep decision lives in the pure `resolveSelectionMouseAction` (asserted directly,
// no renderer), and the end-to-end wiring — OSC 52 staged once, `onCopy` fired once,
// selection cleared, per-app closure scope — is driven offscreen through the
// `dispatchInput` seam against a real renderer. The conditional user-scroll clear
// and its mid-drag guard are exercised at the bottom.
import { describe, expect, test } from 'bun:test'
import type { KeyEvent, MouseEvent } from '@vui-rs/core'
import { Renderer } from '@vui-rs/core'
import { createHostApp, resolveSelectionMouseAction } from '../src/host/create-host-app.ts'
import { VuiScrollBox } from '../src/host/components/scroll-box.ts'
import { defineComponent, h, nextTick } from '../src/index.ts'

function mouse(partial: Partial<MouseEvent>): MouseEvent {
  return {
    type: 'mouse',
    kind: 'down',
    button: 'left',
    x: 0,
    y: 0,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: '',
    ...partial,
  }
}

function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  return { type: 'key', name, ctrl: false, alt: false, shift: false, meta: false, raw: '', ...mods }
}

/** Count OSC 52 passthrough writes on a real renderer without losing the real emit. */
function spyPassthrough(r: Renderer): { count: () => number } {
  let n = 0
  const real = r.stagePassthrough.bind(r)
  ;(r as unknown as { stagePassthrough: (b: Uint8Array) => void }).stagePassthrough = (b: Uint8Array) => {
    n++
    real(b)
  }
  return { count: () => n }
}

describe('resolveSelectionMouseAction (pure decision)', () => {
  const state = (over: Partial<Parameters<typeof resolveSelectionMouseAction>[1]> = {}) => ({
    selecting: false,
    selectionActive: false,
    selectableHit: false,
    ...over,
  })

  test('down on selectable text → begin a selection', () => {
    const a = resolveSelectionMouseAction({ kind: 'down', button: 'left' }, state({ selectableHit: true }), {
      copyOnSelect: false,
    })
    expect(a).toMatchObject({ begin: true, selecting: true, consumed: true, copy: false, clear: false })
  })

  test('down off text with a prior selection → clear and fall through to focus', () => {
    const a = resolveSelectionMouseAction({ kind: 'down', button: 'left' }, state({ selectionActive: true }), {
      copyOnSelect: false,
    })
    expect(a).toMatchObject({ begin: false, clear: true, selecting: false, consumed: false })
  })

  test('drag never copies (single-shot guard) even with copyOnSelect on', () => {
    const a = resolveSelectionMouseAction(
      { kind: 'drag', button: 'left' },
      state({ selecting: true, selectionActive: true }),
      { copyOnSelect: true },
    )
    expect(a).toMatchObject({ copy: false, consumed: true })
  })

  test('up + active + copyOnSelect → copy (closure clears only on copy success)', () => {
    const a = resolveSelectionMouseAction(
      { kind: 'up', button: 'left' },
      state({ selecting: true, selectionActive: true }),
      { copyOnSelect: true },
    )
    expect(a).toMatchObject({ copy: true, clear: false, selecting: false, consumed: true })
  })

  test('up + active + copyOnSelect OFF → keep the selection, no copy/clear', () => {
    const a = resolveSelectionMouseAction(
      { kind: 'up', button: 'left' },
      state({ selecting: true, selectionActive: true }),
      { copyOnSelect: false },
    )
    expect(a).toMatchObject({ copy: false, clear: false, selecting: false, consumed: true })
  })

  test('up with no active selection → clear (a click with no drag)', () => {
    const a = resolveSelectionMouseAction(
      { kind: 'up', button: 'left' },
      state({ selecting: true, selectionActive: false }),
      { copyOnSelect: true },
    )
    expect(a).toMatchObject({ copy: false, clear: true, selecting: false, consumed: true })
  })
})

describe('copy-on-select (end-to-end via dispatchInput)', () => {
  test('copyOnSelect ON: mouse-up copies once, fires onCopy, then clears', () => {
    const r = new Renderer(20, 3)
    const copied: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r, copyOnSelect: true, onCopy: (t) => copied.push(t) })
    app.context.flushNow()
    const osc = spyPassthrough(r)

    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))

    expect(copied).toEqual(['hello']) // fired exactly once with the swept text
    expect(osc.count()).toBe(1) // OSC 52 staged once
    expect(app.context.selection.active).toBe(false) // cleared after copy (D6)

    app.unmount()
    r.free()
  })

  test('drag re-renders during a sweep never re-copy (only the up event copies)', () => {
    const r = new Renderer(20, 3)
    const copied: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r, copyOnSelect: true, onCopy: (t) => copied.push(t) })
    app.context.flushNow()
    const osc = spyPassthrough(r)

    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 2, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 6, y: 0 }))
    expect(osc.count()).toBe(0) // no copy mid-drag
    app.dispatchInput(mouse({ kind: 'up', x: 6, y: 0 }))
    expect(osc.count()).toBe(1)
    expect(copied).toHaveLength(1)

    app.unmount()
    r.free()
  })

  test('copyOnSelect OFF (default): mouse-up does NOT copy; selection persists', () => {
    const r = new Renderer(20, 3)
    const copied: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r, onCopy: (t) => copied.push(t) })
    app.context.flushNow()
    const osc = spyPassthrough(r)

    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))

    expect(copied).toEqual([]) // no auto-copy
    expect(osc.count()).toBe(0)
    expect(app.context.selection.active).toBe(true) // selection kept (manual Ctrl+C still works)

    app.unmount()
    r.free()
  })

  test('Ctrl+C copies, fires onCopy once, and clears so a 2nd Ctrl+C would not re-copy', () => {
    const r = new Renderer(20, 3)
    const copied: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    // onCtrlC keeps a no-copy Ctrl+C from reaching the default process.exit path.
    const app = createHostApp(App).mount({ renderer: r, onCopy: (t) => copied.push(t), onCtrlC: () => {} })
    app.context.flushNow()
    const osc = spyPassthrough(r)

    // Sweep without copyOnSelect → selection stays active.
    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))
    expect(app.context.selection.active).toBe(true)

    app.dispatchInput(key('c', { ctrl: true }))
    expect(copied).toEqual(['hello'])
    expect(osc.count()).toBe(1)
    expect(app.context.selection.active).toBe(false) // cleared (D6)

    // A second Ctrl+C finds no selection → no re-copy (would delegate to onCtrlC).
    app.dispatchInput(key('c', { ctrl: true }))
    expect(osc.count()).toBe(1)
    expect(copied).toHaveLength(1)

    app.unmount()
    r.free()
  })

  test('Cmd+C (meta+c) copies + fires onCopy too', () => {
    const r = new Renderer(20, 3)
    const copied: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r, onCopy: (t) => copied.push(t), onCtrlC: () => {} })
    app.context.flushNow()

    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))
    app.dispatchInput(key('c', { meta: true }))

    expect(copied).toEqual(['hello'])
    expect(app.context.selection.active).toBe(false)

    app.unmount()
    r.free()
  })

  test('two apps in one process do NOT share onCopy/copyOnSelect (closure scope)', () => {
    const ra = new Renderer(20, 3)
    const rb = new Renderer(20, 3)
    const copiedA: string[] = []
    const copiedB: string[] = []
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    // App A opts in; App B keeps the default (off) and a different callback.
    const a = createHostApp(App).mount({ renderer: ra, copyOnSelect: true, onCopy: (t) => copiedA.push(t) })
    const b = createHostApp(App).mount({ renderer: rb, onCopy: (t) => copiedB.push(t) })
    a.context.flushNow()
    b.context.flushNow()

    const sweep = (app: typeof a) => {
      app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
      app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
      app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))
    }
    sweep(a)
    sweep(b)

    expect(copiedA).toEqual(['hello']) // A's copyOnSelect fired only A's onCopy
    expect(copiedB).toEqual([]) // B inherited neither A's flag nor A's callback
    expect(b.context.selection.active).toBe(true) // B kept its selection (off)

    a.unmount()
    b.unmount()
    ra.free()
    rb.free()
  })
})

describe('user-scroll selection clear', () => {
  test('host entry point clears a settled selection but never mid-drag', () => {
    const r = new Renderer(20, 3)
    const App = defineComponent({ setup: () => () => h('text', {}, 'hello world') })
    const app = createHostApp(App).mount({ renderer: r })
    app.context.flushNow()

    // Mid-drag (selecting === true): the guard must NOT clear (would desync the host
    // drag state against a cleared selection model).
    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 0 }))
    expect(app.context.selection.active).toBe(true)
    app.context.invalidateSelection?.()
    expect(app.context.selection.active).toBe(true) // still active mid-drag

    // Release (selecting === false) with the selection kept → now a scroll clears it.
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 0 }))
    expect(app.context.selection.active).toBe(true)
    app.context.invalidateSelection?.()
    expect(app.context.selection.active).toBe(false)

    app.unmount()
    r.free()
  })

  test('a real user wheel scroll clears a settled selection in a scroll-box', async () => {
    const r = new Renderer(10, 3)
    const App = defineComponent({
      setup: () => () =>
        h(VuiScrollBox, { width: 10, height: 2, focused: true }, () => [
          h('text', {}, 'alpha'),
          h('text', {}, 'bravo'),
          h('text', {}, 'gamma'),
          h('text', {}, 'delta'),
        ]),
    })
    const app = createHostApp(App).mount({ renderer: r })
    await nextTick()
    app.context.flushNow()

    // Sweep the first visible line, then release (selecting=false, selection kept).
    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 3, y: 0 }))
    app.dispatchInput(mouse({ kind: 'up', x: 3, y: 0 }))
    expect(app.context.selection.active).toBe(true)

    // A user wheel-down moves the offset → the apply() path invalidates the selection.
    app.dispatchInput(mouse({ kind: 'wheel', button: 'wheelDown', x: 0, y: 0 }))
    app.context.flushNow()
    expect(app.context.selection.active).toBe(false)

    app.unmount()
    r.free()
  })

  test('wheel while dragging preserves rows that leave the scroll viewport', async () => {
    const r = new Renderer(10, 2)
    const copied: string[] = []
    const App = defineComponent({
      setup: () => () =>
        h(VuiScrollBox, { width: 10, height: 2, focused: true }, () => [
          h('text', {}, 'alpha'),
          h('text', {}, 'bravo'),
          h('text', {}, 'gamma'),
          h('text', {}, 'delta'),
        ]),
    })
    const app = createHostApp(App).mount({ renderer: r, copyOnSelect: true, onCopy: (text) => copied.push(text) })
    await nextTick()
    app.context.flushNow()

    app.dispatchInput(mouse({ kind: 'down', x: 0, y: 0 }))
    app.dispatchInput(mouse({ kind: 'drag', x: 4, y: 1 }))
    app.dispatchInput(mouse({ kind: 'wheel', button: 'wheelDown', x: 4, y: 1 }))
    app.context.flushNow()
    app.dispatchInput(mouse({ kind: 'up', x: 4, y: 1 }))

    expect(copied).toEqual(['alpha\nbravo\ngamma'])
    expect(app.context.selection.active).toBe(false)

    app.unmount()
    r.free()
  })
})
