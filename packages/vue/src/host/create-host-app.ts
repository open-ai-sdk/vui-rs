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
import { Renderer } from "@vui-rs/core";
import { BoxRenderable } from "./box-renderable.ts";
import { createHostScheduler } from "./scheduler.ts";
import { createNodeOps } from "./node-ops.ts";
import { runLayout } from "./layout.ts";
import { runPaint } from "./paint-walk.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
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
    theme: darkTheme,
    dirtyLayout: new Set(),
    dirtyText: new Set(),
    scheduleRender: () => {},
    flushNow: () => {},
    dispose: () => {},
    renderCount: 0,
    layout: runLayout,
    paint: runPaint,
  };
  const scheduler = createHostScheduler(ctx);
  ctx.scheduleRender = scheduler.scheduleRender;
  ctx.flushNow = scheduler.flushNow;
  ctx.dispose = scheduler.dispose;
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

  let mounted = false;
  let ownsRenderer = false;

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
      ctx.dispose();
      const owned = ownsRenderer ? ctx.renderer : null;
      ctx.renderer = null;
      owned?.free();
    },
  };

  return app;
}

function createDefaultRenderer(options: HostMountOptions): Renderer {
  const width = options.width ?? process.stdout.columns ?? 80;
  const height = options.height ?? process.stdout.rows ?? 24;
  return new Renderer(width, height);
}
