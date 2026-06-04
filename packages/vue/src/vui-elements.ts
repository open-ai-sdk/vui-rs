// Template type-support for the official Vue extension (Volar / Vue Language
// Tools 2.x) and `vue-tsc`. The vui elements (`<box>`, `<text>`, …) and `<input>`
// are NOT DOM tags and have no `@vue/runtime-dom` JSX intrinsics behind them, so
// without this augmentation Volar reports "unknown element" and gives no prop
// IntelliSense. We register them on `@vue/runtime-core`'s `GlobalComponents`
// (the type-layer equivalent of the renderer's tag catalogue + the global
// `<input>` registration in create-app.ts) so templates get autocomplete and
// strict checking. This carries NO runtime code — only type declarations + a
// global augmentation; the actual prop handling lives in patch-prop.ts /
// paint-prop.ts. It is a real module (not a `.d.ts`) and `index.ts` re-exports
// its prop types, so the augmentation survives dts bundling for published
// consumers (a triple-slash `.d.ts` reference would be dropped by the bundler).
import type { DefineComponent } from "@vue/runtime-core";
import type {
  AlignValue,
  Dim,
  JustifyValue,
  Sides,
  VuiStyle,
} from "@vui-rs/core";
import type { CanvasContext, CanvasRect } from "./host/canvas-renderable.ts";
import type { DispatchableEvent } from "./host/focus.ts";

/** A color: a CSS/hex/name string or a packed `0xRRGGBBAA` number (see `rgba`). */
export type Color = string | number;

/** Layout props — folded into the node's taffy style (mirror of `VuiStyle`). */
interface LayoutProps {
  display?: "flex" | "none";
  position?: "relative" | "absolute";
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  alignItems?: AlignValue;
  alignSelf?: AlignValue;
  justifyContent?: JustifyValue;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Dim;
  width?: Dim;
  height?: Dim;
  minWidth?: Dim;
  minHeight?: Dim;
  maxWidth?: Dim;
  maxHeight?: Dim;
  padding?: Sides;
  margin?: Sides;
  inset?: Sides;
  /** Per-side `inset` shorthands (absolute positioning). */
  top?: Dim;
  right?: Dim;
  bottom?: Dim;
  left?: Dim;
  gap?: number | { width?: number; height?: number };
  /** Border thickness in layout cells; `border` (paint) sets this implicitly. */
  borderWidth?: Dim;
  /** A whole `VuiStyle` object, spread through `patchProp`. */
  style?: VuiStyle;
}

/** Paint props — applied immediately to the Rust node (`set_*`). */
interface PaintProps {
  bg?: Color;
  backgroundColor?: Color;
  fg?: Color;
  color?: Color;
  /** Raw attribute bitmask (OR of `Attr.*`); the boolean flags below OR onto it. */
  attrs?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  border?: boolean | "none" | "single" | "double" | "rounded";
  borderColor?: Color;
  title?: string;
  titleAlign?: "left" | "center" | "right";
  visible?: boolean;
  opacity?: number;
  wrap?: "word" | "char" | "nowrap";
}

/** Focus + keyboard event props (dispatched by the focus manager). */
interface FocusProps {
  /** Participate in Tab focus traversal. */
  focusable?: boolean;
  /** Controlled focus: focus this node on mount / when true. */
  focused?: boolean;
  onKeyDown?: (ev: DispatchableEvent) => void;
  onPaste?: (ev: DispatchableEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** `<box>` — a flex container; the only element that may hold boxes/text. */
export type BoxProps = LayoutProps & PaintProps & FocusProps;
/** `<text>` — holds strings + inline run-style tags; sizes/colors its content. */
export type TextProps = LayoutProps & PaintProps & FocusProps;

/**
 * Inline run-style tags (`<span>`/`<b>`/`<i>`/`<u>`/`<em>`/`<strong>`) — virtual
 * nodes that fold style into the enclosing `<text>`'s runs. They take only run
 * style, not layout.
 */
export interface SpanProps {
  fg?: Color;
  color?: Color;
  bg?: Color;
  backgroundColor?: Color;
  attrs?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

/**
 * `<input>` — resolves to the `VuiInput` component (registered globally in
 * create-app.ts). v-model uses `value` / `update:value`; both `v-model:value`
 * and bare `v-model` type-check (the latter via the `modelValue` aliases here,
 * which the build-time directive transform rewrites to `value`). Layout/paint
 * props fall through to the underlying edit node.
 */
export interface InputProps extends LayoutProps, PaintProps, FocusProps {
  value?: string;
  /** Alias so bare `v-model` type-checks; rewritten to `value` at build time. */
  modelValue?: string;
  placeholder?: string;
  placeholderColor?: Color;
  cursorColor?: Color;
  maxLength?: number;
  "onUpdate:value"?: (value: string) => void;
  "onUpdate:modelValue"?: (value: string) => void;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

/** `<textarea>` — multi-line native-backed editor. */
export interface TextareaProps extends LayoutProps, PaintProps, FocusProps {
  value?: string;
  modelValue?: string;
  placeholder?: string;
  placeholderColor?: Color;
  cursorColor?: Color;
  wrap?: "word" | "char" | "nowrap";
  tabBehavior?: "focus" | "indent";
  tabSize?: number;
  "onUpdate:value"?: (value: string) => void;
  "onUpdate:modelValue"?: (value: string) => void;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

/**
 * `<canvas>` — first-class custom drawing (JS host). `@draw` receives a clamped,
 * clipped `CanvasContext` (local 0-based coords) + the laid-out rect; `buffered`
 * switches to an offscreen framebuffer that re-runs `@draw` only on change.
 */
export interface CanvasProps extends LayoutProps, PaintProps, FocusProps {
  buffered?: boolean;
  onDraw?: (ctx: CanvasContext, rect: CanvasRect) => void;
}

declare module "@vue/runtime-core" {
  interface GlobalComponents {
    box: DefineComponent<BoxProps>;
    text: DefineComponent<TextProps>;
    span: DefineComponent<SpanProps>;
    b: DefineComponent<SpanProps>;
    i: DefineComponent<SpanProps>;
    u: DefineComponent<SpanProps>;
    em: DefineComponent<SpanProps>;
    strong: DefineComponent<SpanProps>;
    input: DefineComponent<InputProps>;
    textarea: DefineComponent<TextareaProps>;
    canvas: DefineComponent<CanvasProps>;
  }
}
