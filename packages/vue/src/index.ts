// @vui-rs/vue — Vue custom renderer binding for the vui-rs terminal engine. Drive
// a terminal UI with Vue's reactivity + components; the retained Renderable tree,
// taffy-via-FFI layout, and the JS paint walk render through a native cell buffer.
// Build a tree with `h()` (or a `.vue` SFC), feed it to `createApp`, and `mount()`
// paints it; reactive changes coalesce into one repaint per frame.
export { createApp, type MountOptions, type VuiApp } from "./create-app.ts";

// The host app + element registry.
export {
  createHostApp,
  type VuiHostApp,
  type HostMountOptions,
} from "./host/create-host-app.ts";
export {
  extend,
  isVuiTag,
  type CatalogueEntry,
} from "./host/catalogue.ts";
export {
  Renderable,
  type HostContext,
  type RenderableKind,
} from "./host/renderable.ts";

// Custom drawing + custom Renderables.
export {
  CanvasRenderable,
  type CanvasContext,
  type CanvasDraw,
  type CanvasRect,
  type CanvasStyle,
} from "./host/canvas-renderable.ts";

// Overlay/portal layer (modals, dialogs, toasts) — the `<overlay>` element.
export { OverlayRenderable } from "./host/overlay.ts";
export { type Backdrop } from "./host/renderable.ts";

// Editable input + keyboard/focus.
export { EditRenderable, type EditState } from "./host/edit-renderable.ts";
export { VuiHostInput, VuiHostInput as VuiInput } from "./host/components/input.ts";
export { TextareaRenderable, type TextareaState } from "./host/textarea-renderable.ts";
export { VuiHostTextarea, VuiHostTextarea as VuiTextarea } from "./host/components/textarea.ts";
export { VuiScrollBox } from "./host/components/scroll-box.ts";
export { VuiScrollBar } from "./host/components/scroll-bar.ts";
export {
  VuiSelect,
  VuiSelectList,
  type SelectItem,
  type SelectItemValue,
} from "./host/components/select-list.ts";
export {
  createHostFocusManager,
  createHostFocusManager as createFocusManager,
  type HostFocusManager,
  type HostFocusManager as FocusManager,
  type DispatchableEvent,
  type DispatchableMouseEvent,
} from "./host/focus.ts";
export { VuiSpinner } from "./components/spinner.ts";

// Re-export the element prop types AND pull `vui-elements` into the module graph
// so its `GlobalComponents` augmentation (template type-support for <box>/<text>/
// <input>/<canvas>) ships in the bundled dist .d.ts. Types-only: erased from JS.
export type {
  BoxProps,
  CanvasProps,
  Color,
  InputProps,
  OverlayProps,
  ScrollBarProps,
  ScrollBoxProps,
  SelectListProps,
  SpanProps,
  TextareaProps,
  TextProps,
} from "./vui-elements.ts";
export { parseColor } from "./color.ts";

// Theming: tokens + composables. Pass a `theme` to `mount()`; read it in
// components with `useTheme()`, or restyle a subtree with `provideTheme()`.
export { type Theme, ThemeSymbol, darkTheme } from "./theme.ts";
export { useTheme, provideTheme } from "./use-theme.ts";

// Re-export the color/attr helpers + key utilities so apps depend on @vui-rs/vue alone.
export {
  Attr,
  EditMotion,
  rgba,
  Key,
  matchesKey,
  type KeyEvent,
  type MouseEvent,
  type InputEvent,
  type TextWrapMode,
} from "@vui-rs/core";

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
