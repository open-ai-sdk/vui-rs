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

export interface VuiHostApp {
  mount(options?: HostMountOptions): VuiHostApp
  unmount(): void
  /** Swap the active theme at runtime (by name, JSON, full theme, or partial) — no remount. */
  setTheme(input: ThemeInput, mode?: 'dark' | 'light'): void
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
  }

  /** True while a left-drag text selection is in progress (between down and up). */
  let selecting = false

  /** Copy the active static-text selection to the system clipboard via OSC 52. */
  function copySelection(): boolean {
    const r = ctx.renderer
    if (!r || !ctx.selection.active) return false
    const text = selectionText(r, ctx.selection)
    if (!text) return false
    const b64 = Buffer.from(text, 'utf8').toString('base64')
    // OSC 52 to the "c"(lipboard) selection; emitted via the passthrough channel,
    // which forces the frame so the one-shot write lands even with no cell change.
    r.stagePassthrough(new TextEncoder().encode(`\x1b]52;c;${b64}\x07`))
    ctx.flushNow()
    return true
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
    if (ev.kind === 'down' && ev.button === 'left') {
      const hit = hitTestTopmost(ctx, ev.x, ev.y)
      if (hit && hit.kind === 'text' && hit.screenRect && !hasInteractiveAncestor(hit)) {
        sel.begin(ev.x, ev.y, hit.screenRect.x0, hit.screenRect.x1)
        selecting = true
        ctx.scheduleRender()
        return true
      }
      // A click off any text region clears a prior selection, then falls through
      // to normal focus handling.
      if (sel.active) {
        sel.clear()
        ctx.scheduleRender()
      }
      selecting = false
      return false
    }
    if (selecting && ev.kind === 'drag') {
      sel.update(ev.x, ev.y)
      ctx.scheduleRender()
      return true
    }
    if (selecting && ev.kind === 'up') {
      sel.update(ev.x, ev.y)
      if (!sel.active) sel.clear() // a click with no drag selects nothing
      selecting = false
      ctx.scheduleRender()
      return true
    }
    return false
  }

  /** Route one decoded input event: selection, copy, Ctrl-C exit, Tab focus, else dispatch. */
  function handleInputEvent(ev: import('@vui-rs/core').InputEvent): void {
    if (ev.type === 'mouse') {
      if (handleSelectionMouse(ev)) return
      ctx.focusManager?.dispatch(ev)
      return
    }
    // Ctrl-C / Cmd-C with an active static-text selection copies (OSC 52) rather
    // than exiting / being ignored.
    if (ev.type === 'key' && (matchesKey(ev, 'ctrl+c') || matchesKey(ev, 'meta+c'))) {
      if (copySelection()) return
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
