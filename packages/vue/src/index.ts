// @vui-rs/vue — Vue custom renderer binding for the vui-rs Rust core. Drive a
// terminal UI with Vue's reactivity + components; `<box>`/`<text>` render through
// the native cell buffer. Build a tree with `h()`, feed it to `createApp`, and
// `mount()` paints it; reactive state changes coalesce into one repaint per frame.
export { createApp, type MountOptions, type VuiApp } from "./create-app.ts";
export { extend, isVuiTag, type CatalogueEntry, type HostKind } from "./catalogue.ts";
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
