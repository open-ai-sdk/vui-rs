// The JS host tree the OpenTUI-style renderer walks and paints. Unlike the FFI
// path (where a `VuiHostNode` wraps an opaque Rust node), a `Renderable` is a
// plain JS object that owns its style/paint/rect and knows how to draw itself via
// `renderSelf(buffer, clip)` (filled in Phase 04). Phase 01 only builds the tree:
// node-ops mutate parent/children and patch-prop routes props onto these fields;
// layout (Phase 03) fills `rect`, paint (Phase 04) implements `renderSelf`.
import type { VuiNode, VuiStyle } from "@vui-rs/core";
import { markRaw } from "@vue/runtime-core";
import type { Theme } from "../theme.ts";

export type RenderableKind = "box" | "text" | "edit" | "span" | "raw-text" | "comment";

/** Run-style a `span` folds into its enclosing `<text>` (mirrors host-node RunStyle). */
export interface RunStyle {
  fg?: number;
  bg?: number;
  attrs: number;
}

/** Visual (non-layout) props a Renderable paints with. The JS twin of Rust PaintProps. */
export interface PaintProps {
  bg?: number;
  fg?: number;
  /** Combined attr bits (base | flags), recomputed on change. */
  attrs: number;
  /** Explicitly-set numeric `attrs`, OR-ed with the boolean attr flags. */
  baseAttrs: number;
  attrFlags: Record<string, number>;
  border: "none" | "single" | "double" | "rounded";
  borderColor?: number;
  title: string;
  titleAlign: "left" | "center" | "right";
  visible: boolean;
  opacity: number;
  wrap: "wrap" | "nowrap";
}

/** Edge insets (padding/border) a laid-out node reports, in cells. */
export interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A node's computed box from layout (Phase 03). Origin is parent-relative. */
export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  padding: Edges;
  border: Edges;
}

/** Paint surface a Renderable draws into — the native cell buffer (Phase 02/04). */
export interface PaintBuffer {
  drawText(x: number, y: number, text: string, fg: number, bg: number | undefined, attrs: number): void;
  fillRect(x: number, y: number, w: number, h: number, bg: number): void;
  setCell(x: number, y: number, ch: number, fg: number, bg: number | undefined, attrs: number): void;
  bgUnder(x: number, y: number): number;
}

/** Half-open clip rect `[x0,x1) × [y0,y1)` — the JS twin of paint.rs `Clip`. */
export interface Clip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function newPaint(): PaintProps {
  return {
    attrs: 0,
    baseAttrs: 0,
    attrFlags: {},
    border: "none",
    title: "",
    titleAlign: "left",
    visible: true,
    opacity: 1,
    wrap: "wrap",
  };
}

/**
 * Base host node. `box`/`text`/`edit` get dedicated subclasses (with a real
 * `renderSelf` in Phase 04); `span`/`raw-text`/`comment` stay base instances —
 * they own no rect and fold into the enclosing `<text>`'s runs.
 */
export class Renderable {
  ctx: HostContext;
  kind: RenderableKind;
  tag: string;
  parent: Renderable | null = null;
  children: Renderable[] = [];
  /**
   * Layout-only native node for `box`/`text`/`edit` (taffy style + text-for-
   * measure ONLY — no paint props; the Renderable paints itself in JS). `null`
   * for virtual nodes (span/raw-text/comment). The L1 layout-via-FFI backing.
   */
  layoutNode: VuiNode | null = null;
  /** Layout bucket (taffy style), flushed to the layout node (Phase 03). */
  style: VuiStyle = {};
  paint: PaintProps = newPaint();
  /** Run-style for `span` nodes. */
  spanStyle: RunStyle = { attrs: 0 };
  /** Value for `raw-text`/`comment`; default-run text for a `<text>` set via setElementText. */
  text = "";
  directText: string | null = null;
  events = new Map<string, (...args: unknown[]) => void>();
  focusable = false;
  /** Unknown props, kept for debugging (parity with the FFI patch-prop). */
  props: Record<string, unknown> = {};
  /** Computed box from layout; null until the first layout pass. */
  rect: LayoutRect | null = null;
  /** Dirty since the last paint walk (drives dirty-subtree skipping in Phase 06). */
  dirty = true;

  constructor(ctx: HostContext, kind: RenderableKind, tag: string) {
    this.ctx = ctx;
    this.kind = kind;
    this.tag = tag;
    // markRaw: a Renderable is host state, never a reactive proxy target.
    return markRaw(this);
  }

  /** Draw this node into the buffer within `clip`. Overridden by subclasses (Phase 04). */
  renderSelf(_buffer: PaintBuffer, _clip: Clip): void {
    // base: span/raw-text/comment paint nothing on their own.
  }

  /** Mark this node (and request a render) as needing repaint. */
  markDirty(): void {
    this.dirty = true;
  }
}

/**
 * Per-app wiring for the JS host path. The native `Renderer` (cell buffer owner)
 * is only known at mount. `paint`/`layout` hooks are filled by later phases; in
 * Phase 01 they are null and `scheduleRender` just bumps the counter.
 */
export interface HostContext {
  renderer: import("@vui-rs/core").Renderer | null;
  root: Renderable | null;
  theme: Theme;
  /** Renderables whose layout style changed since the last layout pass. */
  dirtyLayout: Set<Renderable>;
  /** Renderables whose text runs changed (re-flattened on paint). */
  dirtyText: Set<Renderable>;
  scheduleRender: () => void;
  flushNow: () => void;
  dispose: () => void;
  renderCount: number;
  /** Layout pass (Phase 03); null until wired. */
  layout: ((ctx: HostContext) => void) | null;
  /** Paint walk (Phase 04); null until wired. */
  paint: ((ctx: HostContext) => void) | null;
}
