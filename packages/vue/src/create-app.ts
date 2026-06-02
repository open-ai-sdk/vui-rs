// `createApp` ties Vue to the Rust core. Each app owns its own Vue renderer
// (bound to a fresh `VuiContext`) so multiple apps never share mutable state. The
// mount container is the renderer's implicit root node. In interactive mode it
// owns a `TerminalSession` (raw mode, alt screen, guaranteed restore) and pumps
// stdin → key parser → focus manager → focused node's handlers; terminal resizes
// reflow + repaint. Offscreen mode (an injected renderer / `altScreen: false`)
// skips all terminal I/O, so tests run without touching a tty.
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
import { type VuiContext, type VuiHostNode, createHostRoot } from "./host-node.ts";
import { createFocusManager } from "./focus.ts";
import { createRendererOptions } from "./renderer-options.ts";
import { createScheduler } from "./scheduler.ts";
import { type Theme, ThemeSymbol, darkTheme } from "./theme.ts";
import { VuiInput } from "./components/input.ts";

export interface MountOptions {
  /** Reuse an existing renderer (tests / embedding); otherwise one is created. */
  renderer?: Renderer;
  /** Terminal size when creating a renderer; defaults to the live tty size. */
  width?: number;
  height?: number;
  /**
   * Interactive mode: enter the alt screen, capture keyboard, handle resize, and
   * guarantee terminal restore. Defaults to true unless a renderer is injected
   * (so tests stay offscreen). When false, the app renders without terminal I/O.
   */
  altScreen?: boolean;
  /**
   * App-level theme. Seeds host `<box>`/`<text>` color defaults (canvas bg/fg,
   * text fg, default border color) and becomes the value `useTheme()` returns
   * unless a component overrides it with `provideTheme()`. Defaults to `darkTheme`.
   */
  theme?: Theme;
}

export interface VuiApp {
  mount(options?: MountOptions): VuiApp;
  unmount(): void;
  readonly renderer: Renderer | null;
  readonly context: VuiContext;
}

function newContext(): VuiContext {
  const ctx: VuiContext = {
    renderer: null,
    root: null,
    dirtyStyle: new Set(),
    dirtyText: new Set(),
    pendingFree: [],
    liveNative: new Set(),
    theme: darkTheme,
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    focusManager: null,
  };
  const scheduler = createScheduler(ctx);
  ctx.scheduleRender = scheduler.scheduleRender;
  ctx.flushNow = scheduler.flushNow;
  ctx.dispose = scheduler.dispose;
  ctx.focusManager = createFocusManager(ctx);
  return ctx;
}

export function createApp(rootComponent: Component, rootProps?: Record<string, unknown>): VuiApp {
  const ctx = newContext();
  const { createApp: createVueApp } = createVueRenderer<VuiHostNode, VuiHostNode>(
    createRendererOptions(ctx),
  );
  const vueApp = createVueApp(rootComponent, rootProps ?? null);
  // Built-in components, so SFC templates can use `<input>` (the editable widget)
  // without importing it. `isVuiTag` keeps `input` out of the compiler's element
  // set, so the template resolves it to this component; v-model then round-trips
  // through `VuiInput`'s `value`/`update:value` contract. A literal `h("input")`
  // (inside `VuiInput` itself) is still a host element — Vue only resolves global
  // components for compiler-emitted `resolveComponent`, never for string `h()`.
  vueApp.component("input", VuiInput);

  let mounted = false;
  let ownsRenderer = false;
  let teardownSession: (() => void) | null = null;

  const app: VuiApp = {
    get renderer() {
      return ctx.renderer;
    },
    get context() {
      return ctx;
    },
    mount(options: MountOptions = {}): VuiApp {
      if (mounted) return app;
      mounted = true;
      // Theme must be set before the root/host nodes are created — they seed
      // their color defaults from it. Also provide it app-wide so `useTheme()`
      // returns it unless a component overrides with `provideTheme()`.
      ctx.theme = options.theme ?? darkTheme;
      vueApp.provide(ThemeSymbol, ctx.theme);
      const renderer = options.renderer ?? createDefaultRenderer(options);
      ownsRenderer = options.renderer === undefined;
      ctx.renderer = renderer;
      ctx.root = createHostRoot(ctx, renderer.rootNode());
      if (options.altScreen ?? ownsRenderer) startSession(renderer);
      const before = ctx.renderCount;
      vueApp.mount(ctx.root);
      // Mounting usually paints via the scheduled post-flush render; only force a
      // render if it didn't (e.g. an empty tree), so startup paints exactly once.
      if (ctx.renderCount === before) ctx.flushNow();
      return app;
    },
    unmount(): void {
      if (!mounted) return;
      mounted = false;
      vueApp.unmount();
      ctx.flushNow(); // final paint: frees removed nodes, clears the tree
      // Stop the scheduler BEFORE restoring the terminal / freeing the renderer,
      // so a callback queued during unmount can never render against freed memory.
      ctx.dispose();
      teardownSession?.();
      teardownSession = null;
      const owned = ownsRenderer ? ctx.renderer : null;
      ctx.renderer = null;
      owned?.free();
    },
  };

  /** Wire the terminal session: keyboard pump (focus + Ctrl-C) and resize. */
  function startSession(renderer: Renderer): void {
    const session = createTerminalSession();
    // One decoder per session so a sequence/paste split across stdin reads still
    // parses correctly (it buffers the partial tail until the rest arrives).
    const decoder = createKeyDecoder();
    session.onData((data) => {
      for (const ev of decoder.feed(data)) {
        if (ev.type === "key" && matchesKey(ev, "ctrl+c")) {
          app.unmount();
          process.exit(0);
        }
        if (ev.type === "key" && ev.name === "tab") {
          if (ev.shift) ctx.focusManager?.focusPrev();
          else ctx.focusManager?.focusNext();
          continue;
        }
        ctx.focusManager?.dispatch(ev);
      }
    });
    session.onResize((cols, rows) => {
      if (cols > 0 && rows > 0) {
        renderer.resize(cols, rows);
        ctx.flushNow();
      }
    });
    session.start();
    teardownSession = () => session.stop();
  }

  return app;
}

function createDefaultRenderer(options: MountOptions): Renderer {
  const width = options.width ?? process.stdout.columns ?? 80;
  const height = options.height ?? process.stdout.rows ?? 24;
  return new Renderer(width, height);
}
