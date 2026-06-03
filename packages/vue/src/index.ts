// @vui-rs/vue — Vue custom renderer binding for the vui-rs Rust core. Drive a
// terminal UI with Vue's reactivity + components; `<box>`/`<text>` render through
// the native cell buffer. Build a tree with `h()`, feed it to `createApp`, and
// `mount()` paints it; reactive state changes coalesce into one repaint per frame.
export { createApp, type MountOptions, type VuiApp } from "./create-app.ts";
export { extend, isVuiTag, type CatalogueEntry, type HostKind } from "./catalogue.ts";

// JS host (OpenTUI-style) — opt-in via `VUI_HOST=js` or `createHostApp` directly.
// Strangler: runs alongside the FFI host until the Phase 04 parity cutover.
export {
  createHostApp,
  type VuiHostApp,
  type HostMountOptions,
} from "./host/create-host-app.ts";
export {
  Renderable,
  type HostContext,
  type RenderableKind,
} from "./host/renderable.ts";
export {
  extend as extendHost,
  type CatalogueEntry as HostCatalogueEntry,
} from "./host/catalogue.ts";
export {
  CanvasRenderable,
  type CanvasContext,
  type CanvasDraw,
  type CanvasRect,
  type CanvasStyle,
} from "./host/canvas-renderable.ts";
export { EditRenderable, type EditState } from "./host/edit-renderable.ts";
export {
  createHostFocusManager,
  type HostFocusManager,
  type DispatchableEvent as HostDispatchableEvent,
} from "./host/focus.ts";
export { VuiHostInput } from "./host/components/input.ts";
// Re-export the element prop types AND pull `vui-elements` into the module graph
// so its `GlobalComponents` augmentation (template type-support for <box>/<text>/
// <input>) ships in the bundled dist .d.ts. Types-only: erased from the JS bundle.
export type {
  BoxProps,
  Color,
  InputProps,
  SpanProps,
  TextProps,
} from "./vui-elements.ts";
export { parseColor } from "./color.ts";
export type { VuiContext, VuiHostNode } from "./host-node.ts";
export {
  createFocusManager,
  type FocusManager,
  type DispatchableEvent,
} from "./focus.ts";
export { VuiInput } from "./components/input.ts";
export { VuiSpinner } from "./components/spinner.ts";

// Theming: tokens + composables. Pass a `theme` to `mount()`; read it in
// components with `useTheme()`, or restyle a subtree with `provideTheme()`.
export { type Theme, ThemeSymbol, darkTheme } from "./theme.ts";
export { useTheme, provideTheme } from "./use-theme.ts";

// Re-export the color/attr helpers + key utilities so apps depend on @vui-rs/vue alone.
export { Attr, rgba, Key, matchesKey, type KeyEvent, type InputEvent } from "@vui-rs/core";

// Vue reactivity + authoring API, re-exported so apps depend on @vui-rs/vue alone.
export {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowReactive,
  shallowRef,
  toRef,
  toRefs,
  watch,
  watchEffect,
} from "@vue/runtime-core";
