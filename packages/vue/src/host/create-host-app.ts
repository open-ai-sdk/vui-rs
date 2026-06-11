// `createHostApp` — the JS-host counterpart to `createApp`. It binds Vue to the
// Renderable graph via the JS node-ops (the custom-renderer approach:
// `createRenderer(nodeOps)` → `render(h(App), rootRenderable)`), instead of
// mirroring into a Rust node tree. `ctx.layout` runs the taffy layout pass and
// `ctx.paint` the tree walk, at which point a mounted host app draws to the
// terminal. Unmount = `render(null, container)` then dispose the scheduler.
import { type Component, createRenderer as createVueRenderer, reactive } from '@vue/runtime-core'
import { Renderer, createKeyDecoder, createTerminalSession, matchesKey } from '@vui-rs/core'
import { BoxRenderable } from './box-renderable.ts'
import { VuiCode } from './components/code.ts'
import { VuiDiff } from './components/diff.ts'
import { VuiHostInput } from './components/input.ts'
import { VuiMarkdown } from './components/markdown.ts'
import { VuiScrollBar } from './components/scroll-bar.ts'
import { VuiScrollBox } from './components/scroll-box.ts'
import { VuiSelectList } from './components/select-list.ts'
import { VuiHostTextarea } from './components/textarea.ts'
import { createHostFocusManager } from './focus.ts'
import { hitTestTopmost } from './hit-test.ts'
import { LinkRegistry } from './link-registry.ts'
import { createHostScheduler } from './scheduler.ts'
import { HostSelection, selectionText } from './selection.ts'
import { createNodeOps } from './node-ops.ts'
import { runLayout } from './layout.ts'
import { runPaint } from './paint-walk.ts'
import { type EditRenderable } from './edit-renderable.ts'
import { type HostContext, HostContextSymbol, type Renderable } from './renderable.ts'
import { type TextareaRenderable } from './textarea-renderable.ts'
import { type Theme, ThemeSymbol, darkTheme } from '../theme.ts'
import { type ThemeInput, applyTheme, detectColorScheme, resolveThemeInput } from '../theme/registry.ts'

export interface HostMountOptions {
  renderer?: Renderer
  width?: number
  height?: number
  altScreen?: boolean
  theme?: Theme
  /**
   * Take over the decision for an otherwise-unhandled Ctrl+C instead of the host's
   * default `unmount()` + `process.exit(0)`. It only fires for presses that would
   * have exited — the higher-priority paths still win first and never reach it:
   * active-selection copy (OSC 52), a focused textarea with a selection, and a
   * focused input with `ctrlCBehavior: 'capture'` that consumes the press
   * (preventDefault). When set, the app becomes responsible for exiting itself.
   */
  onCtrlC?: () => void
  /**
   * Auto-copy the active static-text selection to the system clipboard (OSC 52)
   * when a left-drag ends on mouse-up. Default `false` — strictly opt-in, since
   * it places whatever the user swept onto the system-wide clipboard. When on, the
   * release copies once (never re-copies during a streaming re-render), fires
   * `onCopy`, then clears the selection.
   */
  copyOnSelect?: boolean
  /**
   * Called once with the copied text after any successful clipboard copy — the
   * mouse-up auto-copy (when `copyOnSelect`) or a Ctrl+C/Cmd+C over a selection.
   */
  onCopy?: (text: string) => void
}

/**
 * Final disposition of a Ctrl+C that selection-copy did not already consume and a
 * focused textarea-with-selection did not claim. `capturePrevented` is true when a
 * focused `ctrlCBehavior: 'capture'` input already handled the press
 * (preventDefault) — that press is fully consumed. Otherwise an `onCtrlC` override
 * takes over (the app owns exiting); with no override the host exits by default.
 *
 * Pure so the priority can be unit-tested without driving a terminal session.
 */
export type CtrlCAction = 'consume' | 'delegate' | 'exit'
export function resolveCtrlCAction(capturePrevented: boolean, hasOnCtrlC: boolean): CtrlCAction {
  if (capturePrevented) return 'consume'
  return hasOnCtrlC ? 'delegate' : 'exit'
}

/** State the selection-mouse decision reads, all renderer-independent. */
export interface SelectionMouseState {
  /** A left-drag selection is in progress (between down and up). */
  selecting: boolean
  /** The selection covers more than its anchor cell — read AFTER any focus update. */
  selectionActive: boolean
  /** The mouse-down landed on selectable static text (no interactive ancestor). */
  selectableHit: boolean
}

/**
 * What a selection-mouse event resolves to. The host closure applies it: `begin`
 * starts a selection at the event coords, `copy` runs the OSC 52 copy and (on
 * success) fires `onCopy` then clears, `clear` drops the selection outright, and
 * `selecting` (when defined) becomes the new drag flag. `consumed` is the value
 * `handleSelectionMouse` returns — true swallows the event, false lets it fall
 * through to focus handling.
 *
 * Mechanical model mutations that need the renderer (hit-testing the down, extending
 * the focus on drag/up) stay in the closure; this is purely the copy-vs-clear-vs-keep
 * decision, so it's unit-testable without driving a terminal session. The single-shot
 * copy guarantee lives here: only the `up` branch ever sets `copy`, so a streaming
 * re-render (which produces no mouse-up) can never re-copy.
 */
export interface SelectionMouseAction {
  begin: boolean
  copy: boolean
  clear: boolean
  selecting?: boolean
  consumed: boolean
}

export function resolveSelectionMouseAction(
  ev: { kind: import('@vui-rs/core').MouseEvent['kind']; button: import('@vui-rs/core').MouseEvent['button'] },
  state: SelectionMouseState,
  opts: { copyOnSelect: boolean },
): SelectionMouseAction {
  const none: SelectionMouseAction = { begin: false, copy: false, clear: false, consumed: false }
  if (ev.kind === 'down' && ev.button === 'left') {
    if (state.selectableHit) return { ...none, begin: true, selecting: true, consumed: true }
    // Off any text region: drop a prior selection, then fall through to focus.
    return { ...none, clear: state.selectionActive, selecting: false, consumed: false }
  }
  if (state.selecting && ev.kind === 'drag') {
    return { ...none, selecting: true, consumed: true }
  }
  if (state.selecting && ev.kind === 'up') {
    // `selectionActive` here is the post-update value (the closure extends focus first).
    if (!state.selectionActive) return { ...none, clear: true, selecting: false, consumed: true }
    if (opts.copyOnSelect) return { ...none, copy: true, selecting: false, consumed: true }
    return { ...none, selecting: false, consumed: true } // keep selection; manual Ctrl+C still copies
  }
  return none
}

export interface VuiHostApp {
  mount(options?: HostMountOptions): VuiHostApp
  unmount(): void
  /** Swap the active theme at runtime (by name, JSON, full theme, or partial) — no remount. */
  setTheme(input: ThemeInput, mode?: 'dark' | 'light'): void
  /**
   * Feed one decoded input event through the host's routing (selection/copy,
   * Ctrl+C, Tab focus, else dispatch) exactly as the terminal session pump would.
   * The session is only wired when the host owns its renderer (interactive mode),
   * so with an injected renderer this is the seam to drive that input path — e.g.
   * to unit-test copy-on-select offscreen without a real terminal.
   *
   * Carries the full routing's side effects: a bare unhandled Ctrl+C with no
   * `onCtrlC` and no active selection takes the default exit path (`process.exit`),
   * so a test driving Ctrl+C must set `onCtrlC` or hold an active selection.
   */
  dispatchInput(ev: import('@vui-rs/core').InputEvent): void
  readonly renderer: Renderer | null
  readonly context: HostContext
}

function newHostContext(): HostContext {
  const ctx: HostContext = {
    renderer: null,
    root: null,
    overlays: [],
    // Reactive so a runtime `setTheme()` re-renders every `useTheme()` reader.
    theme: reactive({ ...darkTheme }),
    dirtyLayout: new Set(),
    dirtyText: new Set(),
    links: new LinkRegistry(),
    selection: new HostSelection(),
    layoutW: -1,
    layoutH: -1,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    afterLayout: new Set(),
    layoutListeners: new Set(),
    layout: runLayout,
    paint: runPaint,
    focusManager: null,
    // Real registry assigned below (the scheduler owns it but needs `ctx` first).
    animations: undefined as unknown as HostContext['animations'],
  }
  const scheduler = createHostScheduler(ctx)
  ctx.scheduleRender = scheduler.scheduleRender
  ctx.flushNow = scheduler.flushNow
  ctx.dispose = scheduler.dispose
  ctx.animations = scheduler.animations
  ctx.focusManager = createHostFocusManager(ctx)
  return ctx
}

export function createHostApp(rootComponent: Component, rootProps?: Record<string, unknown>): VuiHostApp {
  const ctx = newHostContext()
  const { createApp: createVueApp } = createVueRenderer<Renderable, Renderable>(createNodeOps(ctx))
  const vueApp = createVueApp(rootComponent, rootProps ?? null)
  // Built-in `<input>` widget (JS edit model), so templates use it without import.
  vueApp.component('input', VuiHostInput)
  vueApp.component('textarea', VuiHostTextarea)
  vueApp.component('scroll-box', VuiScrollBox)
  vueApp.component('scroll-bar', VuiScrollBar)
  vueApp.component('select-list', VuiSelectList)
  // Rich-text widgets, usable as `<markdown>`/`<code>`/`<diff>` without import.
  vueApp.component('markdown', VuiMarkdown)
  vueApp.component('code', VuiCode)
  vueApp.component('diff', VuiDiff)

  let mounted = false
  let ownsRenderer = false
  let teardownSession: (() => void) | null = null
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null
  let escTimer: ReturnType<typeof setTimeout> | null = null
  // App-provided override for an unhandled Ctrl+C (see `HostMountOptions.onCtrlC`).
  // Captured in `mount()`; read by `handleInputEvent`'s Ctrl+C fallthrough.
  let onCtrlC: (() => void) | undefined
  // Copy-on-select wiring (see `HostMountOptions.copyOnSelect`/`onCopy`). CLOSURE-
  // scoped per app instance — never module-scope, so multiple apps in one process
  // (notably tests) don't share clipboard behavior. Captured in `mount()`.
  let onCopy: ((text: string) => void) | undefined
  let copyOnSelect = false

  // A lone ESC keypress can't be told apart from the start of a CSI/SS3 sequence
  // (arrow keys, …) until the next byte arrives, so the decoder buffers it. If no
  // follow-up byte comes within this window it's a real Escape — flush it.
  const ESC_FLUSH_MS = 30

  const app: VuiHostApp = {
    get renderer() {
      return ctx.renderer
    },
    get context() {
      return ctx
    },
    mount(options: HostMountOptions = {}): VuiHostApp {
      if (mounted) return app
      mounted = true
      onCtrlC = options.onCtrlC
      onCopy = options.onCopy
      copyOnSelect = options.copyOnSelect ?? false
      // Mutate the reactive theme in place (don't replace the proxy) so the
      // provided reference stays the live one `setTheme()` later updates.
      if (options.theme) Object.assign(ctx.theme, options.theme)
      vueApp.provide(ThemeSymbol, ctx.theme)
      // Expose the host context to composables (e.g. `useTimeline`) via inject.
      vueApp.provide(HostContextSymbol, ctx)
      // A renderer is needed for layout (its taffy node tree is the L1 backing) —
      // create one (or reuse an injected one) before the tree is built so child
      // layout nodes can attach under the root's.
      ctx.renderer = options.renderer ?? createDefaultRenderer(options)
      ownsRenderer = options.renderer === undefined
      // The root Renderable wraps the renderer's implicit root layout node and is
      // the canvas: it paints the theme background + base foreground (mirrors the
      // FFI host's `createHostRoot`, so both hosts produce the same base frame).
      ctx.root = new BoxRenderable(ctx, '#root')
      ctx.root.layoutNode = ctx.renderer.rootNode()
      ctx.root.paint.bg = ctx.theme.bg
      ctx.root.paint.fg = ctx.theme.fg
      // Interactive mode (alt-screen + keyboard); defaults on when we own the
      // renderer, off for injected renderers so tests stay offscreen.
      if (options.altScreen ?? ownsRenderer) startSession(ctx.renderer)
      const before = ctx.renderCount
      vueApp.mount(ctx.root)
      if (ctx.renderCount === before) ctx.flushNow()
      return app
    },
    unmount(): void {
      if (!mounted) return
      mounted = false
      vueApp.unmount()
      ctx.flushNow()
      // Stop the scheduler BEFORE restoring the terminal / freeing the renderer,
      // so a callback queued during unmount can't render against freed memory.
      ctx.dispose()
      teardownSession?.()
      teardownSession = null
      const owned = ownsRenderer ? ctx.renderer : null
      ctx.renderer = null
      owned?.free()
    },
    setTheme(input: ThemeInput, mode?: 'dark' | 'light'): void {
      applyTheme(ctx, resolveThemeInput(input, mode ?? detectColorScheme(), ctx.theme))
    },
    dispatchInput(ev: import('@vui-rs/core').InputEvent): void {
      handleInputEvent(ev)
    },
  }

  /** True while a left-drag text selection is in progress (between down and up). */
  let selecting = false

  // A user-initiated scroll invalidates an active selection (the screen-absolute
  // selection coords would otherwise highlight the wrong glyphs once content moves).
  // Guarded to never clear mid-drag — a bare `selection.clear()` mid-drag would leave
  // `selecting === true` with a dead anchor, since `update` no-ops on a cleared
  // selection. The scroll-box calls this only from its `apply()` path (real user
  // scroll), never from the stick-to-bottom auto-pin.
  ctx.invalidateSelection = (): void => {
    if (!selecting && ctx.selection.active) {
      ctx.selection.clear()
      ctx.scheduleRender()
    }
  }

  /**
   * Copy the active static-text selection to the system clipboard via OSC 52.
   * Returns the copied text so callers can pass it to `onCopy` and decide to clear
   * the selection without re-reading the buffer; null when there's nothing to copy.
   */
  function copySelection(): string | null {
    const r = ctx.renderer
    if (!r || !ctx.selection.active) return null
    const text = selectionText(r, ctx.selection)
    if (!text) return null
    const b64 = Buffer.from(text, 'utf8').toString('base64')
    // OSC 52 to the "c"(lipboard) selection; emitted via the passthrough channel,
    // which forces the frame so the one-shot write lands even with no cell change.
    r.stagePassthrough(new TextEncoder().encode(`\x1b]52;c;${b64}\x07`))
    ctx.flushNow()
    return text
  }

  /**
   * Does `node` or any ancestor carry a mouse handler? Text inside a clickable
   * region (a `<box @mouseDown>` toggle, etc.) must activate that handler on
   * click rather than start a text selection — otherwise the glyph cells swallow
   * the click and only the box's bare cells remain interactive.
   */
  function hasInteractiveAncestor(node: Renderable): boolean {
    for (let n: Renderable | null = node; n; n = n.parent) {
      if (n.events.has('mousedown') || n.events.has('mouseup')) return true
    }
    return false
  }

  /** Drive drag-selection over static `<text>`/`<markdown>`. Returns true if consumed. */
  function handleSelectionMouse(ev: import('@vui-rs/core').MouseEvent): boolean {
    const sel = ctx.selection
    // Resolve the renderer-dependent inputs the pure decision needs: hit-test the
    // down, and extend the focus on drag/up (renderer-free) so `sel.active` reflects
    // the final drag before we decide copy-vs-clear-vs-keep.
    let hit: Renderable | null = null
    if (ev.kind === 'down' && ev.button === 'left') hit = hitTestTopmost(ctx, ev.x, ev.y)
    const selectableHit = !!(hit && hit.kind === 'text' && hit.screenRect && !hasInteractiveAncestor(hit))
    if (selecting && (ev.kind === 'drag' || ev.kind === 'up')) sel.update(ev.x, ev.y)

    const action = resolveSelectionMouseAction(
      { kind: ev.kind, button: ev.button },
      { selecting, selectionActive: sel.active, selectableHit },
      { copyOnSelect },
    )
    if (action.begin && hit?.screenRect) sel.begin(ev.x, ev.y, hit.screenRect.x0, hit.screenRect.x1)
    if (action.copy) {
      // D6: clear only AFTER a successful copy, so a lingering selection can't make
      // the next Ctrl+C re-copy (instead of arming the host's exit path).
      const copied = copySelection()
      if (copied !== null) {
        onCopy?.(copied)
        sel.clear()
      }
    } else if (action.clear) {
      sel.clear()
    }
    if (action.selecting !== undefined) selecting = action.selecting
    if (action.begin || action.copy || action.clear || action.consumed) ctx.scheduleRender()
    return action.consumed
  }

  /** Route one decoded input event: selection, copy, Ctrl-C exit, Tab focus, else dispatch. */
  function handleInputEvent(ev: import('@vui-rs/core').InputEvent): void {
    if (ev.type === 'mouse') {
      if (handleSelectionMouse(ev)) return
      ctx.focusManager?.dispatch(ev)
      return
    }
    // Ctrl-C / Cmd-C with an active static-text selection copies (OSC 52) rather
    // than exiting / being ignored — then (D6) clears, so a second Ctrl+C falls
    // through to the host's exit path instead of re-copying.
    if (ev.type === 'key' && (matchesKey(ev, 'ctrl+c') || matchesKey(ev, 'meta+c'))) {
      const copied = copySelection()
      if (copied !== null) {
        onCopy?.(copied)
        ctx.selection.clear()
        ctx.scheduleRender()
        return
      }
    }
    if (ev.type === 'key' && ev.name === 'escape' && ctx.selection.active) {
      ctx.selection.clear()
      ctx.scheduleRender()
      return
    }
    if (ev.type === 'key' && matchesKey(ev, 'ctrl+c')) {
      const current = ctx.focusManager?.current()
      if (current?.kind === 'textarea' && (current as TextareaRenderable).hasSelection()) {
        ctx.focusManager?.dispatch(ev)
        return
      }
      // A focused input that opts in (`ctrlCBehavior: 'capture'`) gets first crack
      // at Ctrl+C — e.g. to clear its text. If a handler consumes it (preventDefault),
      // don't quit; an unhandled Ctrl+C (e.g. the input was already empty) still exits.
      let capturePrevented = false
      if (current?.kind === 'edit' && (current as EditRenderable).edit.ctrlCBehavior === 'capture') {
        ctx.focusManager?.dispatch(ev)
        capturePrevented = (ev as { defaultPrevented?: boolean }).defaultPrevented === true
      }
      const action = resolveCtrlCAction(capturePrevented, onCtrlC !== undefined)
      if (action === 'consume') return
      if (action === 'delegate') {
        // App owns the press now (e.g. arm an exit-confirm) — host does not exit.
        onCtrlC?.()
        return
      }
      app.unmount()
      process.exit(0)
    }
    if (ev.type === 'key' && ev.name === 'tab') {
      const current = ctx.focusManager?.current()
      if (current?.kind === 'textarea' && (current as TextareaRenderable).textarea.tabBehavior === 'indent') {
        ctx.focusManager?.dispatch(ev)
        return
      }
      // An input that opted in (`tabBehavior: 'capture'`) receives Tab instead of
      // it driving focus traversal — its wrapper's keyDown handler can then drive
      // an autocomplete completion. The input itself ignores Tab, so it bubbles.
      if (current?.kind === 'edit' && (current as EditRenderable).edit.tabBehavior === 'capture') {
        ctx.focusManager?.dispatch(ev)
        return
      }
      if (ev.shift) ctx.focusManager?.focusPrev()
      else ctx.focusManager?.focusNext()
      return
    }
    ctx.focusManager?.dispatch(ev)
  }

  /** Wire the terminal session: keyboard pump (Tab focus + Ctrl-C) and resize. */
  function startSession(renderer: Renderer): void {
    const session = createTerminalSession()
    const decoder = createKeyDecoder()
    const clearEscTimer = (): void => {
      if (escTimer) {
        clearTimeout(escTimer)
        escTimer = null
      }
    }
    session.onData((data) => {
      clearEscTimer()
      for (const ev of decoder.feed(data)) handleInputEvent(ev)
      // A buffered partial tail (notably a lone ESC) is flushed as a real key if
      // no follow-up byte arrives — so Escape fires on the first press, not the
      // next keystroke.
      if (decoder.pending() !== '') {
        escTimer = setTimeout(() => {
          escTimer = null
          for (const ev of decoder.flush()) handleInputEvent(ev)
        }, ESC_FLUSH_MS)
      }
    })
    session.onResize((cols, rows) => {
      if (cols > 0 && rows > 0) {
        renderer.resize(cols, rows)
        ctx.flushNow()
      }
    })
    session.start()
    keepAliveTimer = setInterval(() => {}, 1 << 30)
    teardownSession = () => {
      clearEscTimer()
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer)
        keepAliveTimer = null
      }
      session.stop()
    }
  }

  return app
}

function createDefaultRenderer(options: HostMountOptions): Renderer {
  const width = options.width ?? process.stdout.columns ?? 80
  const height = options.height ?? process.stdout.rows ?? 24
  return new Renderer(width, height)
}
