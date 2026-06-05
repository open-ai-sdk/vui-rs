// `createHostApp` — the JS-host counterpart to `createApp`. It binds Vue to the
// Renderable graph via the JS node-ops (TresJS pattern: `createRenderer(nodeOps)`
// → `render(h(App), rootRenderable)`), instead of mirroring into a Rust node
// tree. Phase 01 stands this up behind a flag with NO paint (layout/paint hooks
// null); later phases fill `ctx.layout` (03) and `ctx.paint` (04), at which point
// a mounted host app draws to the terminal. Lifecycle mirrors TresJS: unmount =
// `render(null, container)` then dispose the scheduler.
import {
  type Component,
  createRenderer as createVueRenderer,
} from "@vue/runtime-core";
import {
  Renderer,
  createKeyDecoder,
  createTerminalSession,
  matchesKey,
} from "@vui-rs/core";
import { BoxRenderable } from "./box-renderable.ts";
import { VuiCode } from "./components/code.ts";
import { VuiDiff } from "./components/diff.ts";
import { VuiHostInput } from "./components/input.ts";
import { VuiMarkdown } from "./components/markdown.ts";
import { VuiScrollBar } from "./components/scroll-bar.ts";
import { VuiScrollBox } from "./components/scroll-box.ts";
import { VuiSelectList } from "./components/select-list.ts";
import { VuiHostTextarea } from "./components/textarea.ts";
import { createHostFocusManager } from "./focus.ts";
import { createHostScheduler } from "./scheduler.ts";
import { createNodeOps } from "./node-ops.ts";
import { runLayout } from "./layout.ts";
import { runPaint } from "./paint-walk.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { type TextareaRenderable } from "./textarea-renderable.ts";
import { type Theme, ThemeSymbol, darkTheme } from "../theme.ts";

export interface HostMountOptions {
  renderer?: Renderer;
  width?: number;
  height?: number;
  altScreen?: boolean;
  theme?: Theme;
}

export interface VuiHostApp {
  mount(options?: HostMountOptions): VuiHostApp;
  unmount(): void;
  readonly renderer: Renderer | null;
  readonly context: HostContext;
}

function newHostContext(): HostContext {
  const ctx: HostContext = {
    renderer: null,
    root: null,
    overlays: [],
    theme: darkTheme,
    dirtyLayout: new Set(),
    dirtyText: new Set(),
    layoutW: -1,
    layoutH: -1,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    afterLayout: new Set(),
    layout: runLayout,
    paint: runPaint,
    focusManager: null,
  };
  const scheduler = createHostScheduler(ctx);
  ctx.scheduleRender = scheduler.scheduleRender;
  ctx.flushNow = scheduler.flushNow;
  ctx.dispose = scheduler.dispose;
  ctx.focusManager = createHostFocusManager(ctx);
  return ctx;
}

export function createHostApp(
  rootComponent: Component,
  rootProps?: Record<string, unknown>,
): VuiHostApp {
  const ctx = newHostContext();
  const { createApp: createVueApp } = createVueRenderer<Renderable, Renderable>(
    createNodeOps(ctx),
  );
  const vueApp = createVueApp(rootComponent, rootProps ?? null);
  // Built-in `<input>` widget (JS edit model), so templates use it without import.
  vueApp.component("input", VuiHostInput);
  vueApp.component("textarea", VuiHostTextarea);
  vueApp.component("scroll-box", VuiScrollBox);
  vueApp.component("scroll-bar", VuiScrollBar);
  vueApp.component("select-list", VuiSelectList);
  // Rich-text widgets, usable as `<markdown>`/`<code>`/`<diff>` without import.
  vueApp.component("markdown", VuiMarkdown);
  vueApp.component("code", VuiCode);
  vueApp.component("diff", VuiDiff);

  let mounted = false;
  let ownsRenderer = false;
  let teardownSession: (() => void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let escTimer: ReturnType<typeof setTimeout> | null = null;

  // A lone ESC keypress can't be told apart from the start of a CSI/SS3 sequence
  // (arrow keys, …) until the next byte arrives, so the decoder buffers it. If no
  // follow-up byte comes within this window it's a real Escape — flush it.
  const ESC_FLUSH_MS = 30;

  const app: VuiHostApp = {
    get renderer() {
      return ctx.renderer;
    },
    get context() {
      return ctx;
    },
    mount(options: HostMountOptions = {}): VuiHostApp {
      if (mounted) return app;
      mounted = true;
      ctx.theme = options.theme ?? darkTheme;
      vueApp.provide(ThemeSymbol, ctx.theme);
      // A renderer is needed for layout (its taffy node tree is the L1 backing) —
      // create one (or reuse an injected one) before the tree is built so child
      // layout nodes can attach under the root's.
      ctx.renderer = options.renderer ?? createDefaultRenderer(options);
      ownsRenderer = options.renderer === undefined;
      // The root Renderable wraps the renderer's implicit root layout node and is
      // the canvas: it paints the theme background + base foreground (mirrors the
      // FFI host's `createHostRoot`, so both hosts produce the same base frame).
      ctx.root = new BoxRenderable(ctx, "#root");
      ctx.root.layoutNode = ctx.renderer.rootNode();
      ctx.root.paint.bg = ctx.theme.bg;
      ctx.root.paint.fg = ctx.theme.fg;
      // Interactive mode (alt-screen + keyboard); defaults on when we own the
      // renderer, off for injected renderers so tests stay offscreen.
      if (options.altScreen ?? ownsRenderer) startSession(ctx.renderer);
      const before = ctx.renderCount;
      vueApp.mount(ctx.root);
      if (ctx.renderCount === before) ctx.flushNow();
      return app;
    },
    unmount(): void {
      if (!mounted) return;
      mounted = false;
      vueApp.unmount();
      ctx.flushNow();
      // Stop the scheduler BEFORE restoring the terminal / freeing the renderer,
      // so a callback queued during unmount can't render against freed memory.
      ctx.dispose();
      teardownSession?.();
      teardownSession = null;
      const owned = ownsRenderer ? ctx.renderer : null;
      ctx.renderer = null;
      owned?.free();
    },
  };

  /** Route one decoded input event: Ctrl-C exit, Tab focus, else dispatch. */
  function handleInputEvent(ev: import("@vui-rs/core").InputEvent): void {
    if (ev.type === "key" && matchesKey(ev, "ctrl+c")) {
      const current = ctx.focusManager?.current();
      if (
        current?.kind === "textarea" &&
        (current as TextareaRenderable).hasSelection()
      ) {
        ctx.focusManager?.dispatch(ev);
        return;
      }
      app.unmount();
      process.exit(0);
    }
    if (ev.type === "key" && ev.name === "tab") {
      const current = ctx.focusManager?.current();
      if (
        current?.kind === "textarea" &&
        (current as TextareaRenderable).textarea.tabBehavior === "indent"
      ) {
        ctx.focusManager?.dispatch(ev);
        return;
      }
      if (ev.shift) ctx.focusManager?.focusPrev();
      else ctx.focusManager?.focusNext();
      return;
    }
    ctx.focusManager?.dispatch(ev);
  }

  /** Wire the terminal session: keyboard pump (Tab focus + Ctrl-C) and resize. */
  function startSession(renderer: Renderer): void {
    const session = createTerminalSession();
    const decoder = createKeyDecoder();
    const clearEscTimer = (): void => {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
    };
    session.onData((data) => {
      clearEscTimer();
      for (const ev of decoder.feed(data)) handleInputEvent(ev);
      // A buffered partial tail (notably a lone ESC) is flushed as a real key if
      // no follow-up byte arrives — so Escape fires on the first press, not the
      // next keystroke.
      if (decoder.pending() !== "") {
        escTimer = setTimeout(() => {
          escTimer = null;
          for (const ev of decoder.flush()) handleInputEvent(ev);
        }, ESC_FLUSH_MS);
      }
    });
    session.onResize((cols, rows) => {
      if (cols > 0 && rows > 0) {
        renderer.resize(cols, rows);
        ctx.flushNow();
      }
    });
    session.start();
    keepAliveTimer = setInterval(() => {}, 1 << 30);
    teardownSession = () => {
      clearEscTimer();
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      session.stop();
    };
  }

  return app;
}

function createDefaultRenderer(options: HostMountOptions): Renderer {
  const width = options.width ?? process.stdout.columns ?? 80;
  const height = options.height ?? process.stdout.rows ?? 24;
  return new Renderer(width, height);
}
