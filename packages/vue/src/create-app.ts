// `createApp` ties Vue to the Rust core. Each app owns its own Vue renderer
// (bound to a fresh `VuiContext`) so multiple apps never share mutable state. The
// mount container is the renderer's implicit root node. `mount` enters the alt
// screen + hides the cursor (with guaranteed teardown); `unmount` flushes node
// frees, paints the cleared tree, and restores the terminal.
import {
  type Component,
  createRenderer as createVueRenderer,
} from "@vue/runtime-core";
import { Renderer } from "@vui-rs/core";
import { type VuiContext, type VuiHostNode, createHostRoot } from "./host-node.ts";
import { createRendererOptions } from "./renderer-options.ts";
import { createScheduler } from "./scheduler.ts";

export interface MountOptions {
  /** Reuse an existing renderer (tests / embedding); otherwise one is created. */
  renderer?: Renderer;
  /** Terminal size when creating a renderer; defaults to the live tty size. */
  width?: number;
  height?: number;
  /** Enter the alt screen + hide cursor. Defaults to true unless a renderer is passed. */
  altScreen?: boolean;
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
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
  };
  const scheduler = createScheduler(ctx);
  ctx.scheduleRender = scheduler.scheduleRender;
  ctx.flushNow = scheduler.flushNow;
  ctx.dispose = scheduler.dispose;
  return ctx;
}

export function createApp(rootComponent: Component, rootProps?: Record<string, unknown>): VuiApp {
  const ctx = newContext();
  const { createApp: createVueApp } = createVueRenderer<VuiHostNode, VuiHostNode>(
    createRendererOptions(ctx),
  );
  const vueApp = createVueApp(rootComponent, rootProps ?? null);

  let mounted = false;
  let ownsRenderer = false;
  let restore: (() => void) | null = null;

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
      const renderer = options.renderer ?? createDefaultRenderer(options);
      ownsRenderer = options.renderer === undefined;
      ctx.renderer = renderer;
      ctx.root = createHostRoot(ctx, renderer.rootNode());
      if (options.altScreen ?? ownsRenderer) restore = enterTerminal();
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
      // Stop the scheduler and detach the renderer BEFORE freeing it, so a
      // callback queued during unmount can never render against freed memory.
      ctx.dispose();
      const owned = ownsRenderer ? ctx.renderer : null;
      ctx.renderer = null;
      restore?.();
      restore = null;
      owned?.free();
    },
  };
  return app;
}

function createDefaultRenderer(options: MountOptions): Renderer {
  const width = options.width ?? process.stdout.columns ?? 80;
  const height = options.height ?? process.stdout.rows ?? 24;
  return new Renderer(width, height);
}

/**
 * Enter the alt screen + hide the cursor, returning an idempotent restore. Also
 * wires exit/signal handlers so the terminal is always restored, even on crash.
 */
function enterTerminal(): () => void {
  const out = process.stdout;
  out.write("\x1b[?1049h\x1b[?25l");
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    out.write("\x1b[?25h\x1b[?1049l");
  };
  const onSignal = (): void => {
    restore();
    process.exit(0);
  };
  process.once("exit", restore);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return restore;
}
