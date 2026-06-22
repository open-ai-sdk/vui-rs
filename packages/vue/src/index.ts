// @vui-rs/vue — Vue custom renderer binding for the vui-rs terminal engine. Drive
// a terminal UI with Vue's reactivity + components; the retained Renderable tree,
// taffy-via-FFI layout, and the JS paint walk render through a native cell buffer.
// Build a tree with `h()` (or a `.vue` SFC), feed it to `createApp`, and `mount()`
// paints it; reactive changes coalesce into one repaint per frame.
export { createApp, type MountOptions, type VuiApp } from './create-app.ts'

// The host app + element registry.
export { createHostApp, type VuiHostApp, type HostMountOptions } from './host/create-host-app.ts'
export { extend, isVuiTag, type CatalogueEntry } from './host/catalogue.ts'
export { Renderable, HostContextSymbol, type HostContext, type RenderableKind } from './host/renderable.ts'

// Custom drawing + custom Renderables.
export {
  CanvasRenderable,
  type CanvasContext,
  type CanvasDraw,
  type CanvasRect,
  type CanvasStyle,
} from './host/canvas-renderable.ts'

// Overlay/portal layer (modals, dialogs, toasts) — the `<overlay>` element.
export { OverlayRenderable } from './host/overlay.ts'
export { type Backdrop } from './host/renderable.ts'

// Inline images: the `<image>` element plus the encoding picker so apps can show
// which tier (kitty / iterm2 / halfblock) is active.
export { ImageRenderable } from './host/image-renderable.ts'
export { selectImageEncoding, type ImageEncoding } from './host/image-encode.ts'

// Editable input + keyboard/focus.
export { EditRenderable, type EditState } from './host/edit-renderable.ts'
export {
  VuiHostInput,
  VuiHostInput as VuiInput,
  makeHostPasteEvent,
  type HostPasteEvent,
} from './host/components/input.ts'
export { TextareaRenderable, type TextareaState } from './host/textarea-renderable.ts'
export { VuiHostTextarea, VuiHostTextarea as VuiTextarea } from './host/components/textarea.ts'
export { VuiScrollBox } from './host/components/scroll-box.ts'
export { VuiScrollBar } from './host/components/scroll-bar.ts'
export { VuiSelect, VuiSelectList, type SelectItem, type SelectItemValue } from './host/components/select-list.ts'
export {
  createHostFocusManager,
  createHostFocusManager as createFocusManager,
  type HostFocusManager,
  type HostFocusManager as FocusManager,
  type DispatchableEvent,
  type DispatchableMouseEvent,
} from './host/focus.ts'
export { VuiSpinner, SPINNER_PRESETS, type SpinnerPreset } from './components/spinner.ts'

// Animation/timeline engine: easing curves + number tweens driven by the
// scheduler's frame loop, plus the `useTimeline()`/`useAnimation()` composables.
export { type EasingFn, type EasingName, easings, resolveEasing } from './host/animation/easing.ts'
export {
  type AnimateOptions,
  type Animation,
  type AnimationRegistry,
  createAnimation,
  createAnimationRegistry,
} from './host/animation/timeline.ts'
export { type Timeline, useAnimation, useTimeline } from './host/animation/use-timeline.ts'

// Anchor tracking: read an element's absolute screen rect reactively (drives
// anchored popups like the autocomplete overlay).
export { useElementRect, type ScreenMeasure } from './use-element-rect.ts'

// Rich text: markdown, syntax-highlighted code, unified diff — the `<markdown>`/
// `<code>`/`<diff>` widgets (registered globally at app create).
export { VuiMarkdown } from './host/components/markdown.ts'
export { VuiCode } from './host/components/code.ts'
export { VuiDiff } from './host/components/diff.ts'
export {
  type Highlighter,
  type StyledLine,
  type SyntaxPalette,
  createDefaultHighlighter,
  defaultHighlighter,
  syntaxPaletteFromTheme,
} from './host/highlighter.ts'
export {
  type MdBlock,
  type MdSpan,
  type ParseState,
  parseMarkdown,
  parseMarkdownIncremental,
  tokensToBlocks,
} from './host/markdown-parser.ts'
export { type DiffLine, type DiffLineKind, parseUnifiedDiff } from './host/diff-parser.ts'

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
} from './vui-elements.ts'
export { parseColor } from './color.ts'

// Theming: tokens + composables. Pass a `theme` to `mount()`; read it in
// components with `useTheme()`, restyle a subtree with `provideTheme()`, or swap
// the whole theme at runtime with `app.setTheme()` / `useSetTheme()`. Theme JSON files (and `~/.vui/themes/*.json`) load via
// the loader/registry. `contrast` helpers pick a readable fg for a given bg.
export { type Theme, ThemeSymbol, darkTheme, lightTheme } from './theme.ts'
export { useTheme, provideTheme, useSetTheme } from './use-theme.ts'
export { type ColorValue, type ThemeJson, loadThemeFile, resolveThemeJson } from './theme/loader.ts'
export {
  type ThemeInput,
  BUILTIN_THEMES,
  detectColorScheme,
  listThemes,
  registerTheme,
  resolveTheme,
} from './theme/registry.ts'
export { isLight, luminance, pickForeground } from './theme/contrast.ts'

// Re-export the color/attr helpers + key utilities so apps depend on @vui-rs/vue alone.
export {
  Attr,
  EditMotion,
  rgba,
  Key,
  matchesKey,
  queryBackgroundColor,
  queryColorScheme,
  type QueryColorSchemeOptions,
  type KeyEvent,
  type MouseEvent,
  type ThemeEvent,
  type InputEvent,
  type TextWrapMode,
} from '@vui-rs/core'

// Vue reactivity + authoring API, re-exported so apps depend on @vui-rs/vue alone.
export {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
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
} from '@vue/runtime-core'
