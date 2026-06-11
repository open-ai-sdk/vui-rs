// The JS host tree the renderer walks and paints. Unlike the FFI
// path (where a `VuiHostNode` wraps an opaque Rust node), a `Renderable` is a
// plain JS object that owns its style/paint/rect and knows how to draw itself via
// `renderSelf(buffer, clip)` (filled in Phase 04). Phase 01 only builds the tree:
// node-ops mutate parent/children and patch-prop routes props onto these fields;
// layout (Phase 03) fills `rect`, paint (Phase 04) implements `renderSelf`.
import type { TextWrapMode, VuiNode, VuiStyle } from '@vui-rs/core'
import { type InjectionKey, markRaw } from '@vue/runtime-core'
import type { AnimationRegistry } from './animation/timeline.ts'
import type { Theme } from '../theme.ts'

export type RenderableKind = 'box' | 'text' | 'edit' | 'textarea' | 'span' | 'raw-text' | 'comment'

/** Run-style a `span` folds into its enclosing `<text>` (mirrors host-node RunStyle). */
export interface RunStyle {
  fg?: number
  bg?: number
  attrs: number
  /** OSC 8 link target; resolved to a link id and ORed into the run's attrs. */
  link?: string
}

/**
 * Opaque dim backdrop an overlay can paint under itself: each covered cell is
 * read back and rewritten with its glyph kept but its fg/bg scaled toward black
 * by `darken` (0..1). No real alpha — the terminal has none — just a darker
 * opaque rewrite, enough to push the layer behind a modal into the background.
 */
export interface Backdrop {
  /** Brightness multiplier for the covered cells (0 = black, 1 = unchanged). */
  darken: number
}

/** Visual (non-layout) props a Renderable paints with. The JS twin of Rust PaintProps. */
export interface PaintProps {
  bg?: number
  fg?: number
  /** Combined attr bits (base | flags), recomputed on change. */
  attrs: number
  /** Explicitly-set numeric `attrs`, OR-ed with the boolean attr flags. */
  baseAttrs: number
  attrFlags: Record<string, number>
  border: 'none' | 'single' | 'double' | 'rounded'
  borderColor?: number
  title: string
  titleAlign: 'left' | 'center' | 'right'
  visible: boolean
  opacity: number
  wrap: TextWrapMode
  /**
   * How children that exceed this node's content box are treated at paint time.
   * `visible` (default) lets them spill — children are clipped only by the
   * inherited ancestor clip, not this box's content box. `hidden`/`scroll` clip
   * children to the content box (a viewport); `scroll` additionally pairs with a
   * scroll offset + scrollbar. Paint-only — layout (taffy) is unaffected.
   */
  overflow: 'visible' | 'hidden' | 'scroll'
  /** Paint order among siblings (and among overlays); higher draws later/on top. */
  zIndex: number
  /** Opaque dim backdrop painted under an overlay's content; undefined = none. */
  backdrop?: Backdrop
}

/** Edge insets (padding/border) a laid-out node reports, in cells. */
export interface Edges {
  left: number
  right: number
  top: number
  bottom: number
}

/** A node's computed box from layout (Phase 03). Origin is parent-relative. */
export interface LayoutRect {
  x: number
  y: number
  w: number
  h: number
  padding: Edges
  border: Edges
}

/** Half-open clip rect `[x0,x1) × [y0,y1)` — the JS twin of paint.rs `Clip`. */
export interface Clip {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Absolute rounded half-open screen rect cached during the paint walk. */
export type ScreenRect = Clip

/**
 * Paint surface a Renderable draws into — the native cell buffer, via the
 * clip-aware prims. Every op takes the clip (already intersected with the
 * buffer). `bgUnder` reads the current cell background so a transparent glyph
 * keeps whatever it sits on (the JS twin of paint.rs `bg_under`).
 */
export interface PaintBuffer {
  fillRect(x: number, y: number, w: number, h: number, bg: number, clip: Clip): void
  setCell(x: number, y: number, ch: number, fg: number, bg: number, attrs: number, clip: Clip): void
  /** Draw a whole string on a row, clipped (one FFI op). Used by the canvas ctx. */
  drawText(x: number, y: number, text: string, fg: number, bg: number, attrs: number, clip: Clip): void
  /** Draw a native editor view in one clipped FFI op. */
  drawEditor(
    view: import('@vui-rs/core').EditorView,
    x: number,
    y: number,
    fg: number,
    bg: number,
    cursorBg: number,
    attrs: number,
    clip: Clip,
  ): void
  /** Draw a native text-buffer view in one clipped FFI op. */
  drawTextBuffer(
    view: import('@vui-rs/core').TextBufferView,
    x: number,
    y: number,
    fg: number,
    bg: number | undefined,
    attrs: number,
    clip: Clip,
  ): void
  /** Composite an offscreen buffer into the back buffer at `(dstX,dstY)`, clipped. */
  blit(src: import('@vui-rs/core').OffscreenBuffer, dstX: number, dstY: number, clip: Clip): void
  bgUnder(x: number, y: number): number
  /**
   * The whole cell currently at `(x,y)` — glyph + colors + attrs — read back from
   * the live buffer. Lets the overlay backdrop darken a cell in place while
   * keeping its glyph (the JS-only twin of `bgUnder`, widened to all fields).
   */
  cellUnder(x: number, y: number): CellUnder
}

/** A cell read back from the buffer: packed colors as `0xRRGGBBAA`. */
export interface CellUnder {
  ch: number
  fg: number
  bg: number
  attrs: number
}

/**
 * Geometry a Renderable paints with, computed by the paint walk: the rounded
 * absolute border box (`x0..y1`) + its clip, and the content box (`cx0..cy1`,
 * inset by border+padding) + its clip. The JS twin of paint.rs `paint_node`'s
 * locals, handed to `renderSelf`.
 */
export interface PaintCtx {
  x0: number
  y0: number
  x1: number
  y1: number
  clip: Clip
  cx0: number
  cy0: number
  cx1: number
  cy1: number
  contentClip: Clip
}

export function newPaint(): PaintProps {
  return {
    attrs: 0,
    baseAttrs: 0,
    attrFlags: {},
    border: 'none',
    title: '',
    titleAlign: 'left',
    visible: true,
    opacity: 1,
    wrap: 'word',
    overflow: 'visible',
    zIndex: 0,
  }
}

/**
 * Base host node. `box`/`text`/`edit` get dedicated subclasses (with a real
 * `renderSelf` in Phase 04); `span`/`raw-text`/`comment` stay base instances —
 * they own no rect and fold into the enclosing `<text>`'s runs.
 */
export class Renderable {
  ctx: HostContext
  kind: RenderableKind
  tag: string
  parent: Renderable | null = null
  children: Renderable[] = []
  /**
   * Layout-only native node for `box`/`text`/`edit` (taffy style + text-for-
   * measure ONLY — no paint props; the Renderable paints itself in JS). `null`
   * for virtual nodes (span/raw-text/comment). The L1 layout-via-FFI backing.
   */
  layoutNode: VuiNode | null = null
  /** Layout bucket (taffy style), flushed to the layout node (Phase 03). */
  style: VuiStyle = {}
  paint: PaintProps = newPaint()
  /** Run-style for `span` nodes. */
  spanStyle: RunStyle = { attrs: 0 }
  /** Value for `raw-text`/`comment`; default-run text for a `<text>` set via setElementText. */
  text = ''
  directText: string | null = null
  events = new Map<string, (...args: unknown[]) => void>()
  focusable = false
  /**
   * Whether a mouse-down may move focus TO this node. Default `true`: a click on
   * (or inside) a focusable node focuses it, as usual. Set `false` for a container
   * that must hold focus programmatically (an app shell that owns global keys while
   * busy) yet must NOT steal focus from an input when the user clicks elsewhere in
   * it — the click-to-focus walk and Tab traversal skip it, but `focus(node)` and
   * the `:focused` prop still focus it. Only meaningful when `focusable`.
   */
  clickFocus = true
  /** Unknown props, kept for debugging (parity with the FFI patch-prop). */
  props: Record<string, unknown> = {}
  /** Computed box from layout; null until the first layout pass. */
  rect: LayoutRect | null = null
  /** Paint-time scroll offset applied to this node's children. */
  scrollX = 0
  scrollY = 0
  /** Absolute rounded border box from the last paint walk; null until painted. */
  screenRect: ScreenRect | null = null
  /**
   * Overlay/portal root: laid out absolute on the terminal (its layout node is
   * hoisted under the renderer root), skipped by the main paint walk, and drawn
   * by the separate overlay pass on top of the tree. Set by `OverlayRenderable`.
   */
  isOverlay = false
  /**
   * A focus-trapping overlay: while mounted, Tab/Shift-Tab focus is confined to
   * this overlay's subtree (the active modal). Non-trapping overlays (toasts,
   * popups) leave the underlying tab order intact. Set via the `trapFocus` prop.
   */
  trapFocus = false
  /** Dirty since the last paint walk (drives dirty-subtree skipping in Phase 06). */
  dirty = true

  constructor(ctx: HostContext, kind: RenderableKind, tag: string) {
    this.ctx = ctx
    this.kind = kind
    this.tag = tag
    // markRaw: a Renderable is host state, never a reactive proxy target.
    return markRaw(this)
  }

  /** Draw this node into the buffer with the walk-computed geometry. Overridden by subclasses. */
  renderSelf(_buffer: PaintBuffer, _ctx: PaintCtx): void {
    // base: span/raw-text/comment paint nothing on their own.
  }

  /** Mark this node (and request a render) as needing repaint. */
  markDirty(): void {
    this.dirty = true
  }

  /**
   * Release any native resources this node owns (e.g. a canvas's offscreen
   * buffer). Called for every node in a removed subtree. Base: nothing to free.
   */
  dispose(): void {}
}

/**
 * Per-app wiring for the JS host path. The native `Renderer` (cell buffer owner)
 * is only known at mount. `paint`/`layout` hooks are filled by later phases; in
 * Phase 01 they are null and `scheduleRender` just bumps the counter.
 */
export interface HostContext {
  renderer: import('@vui-rs/core').Renderer | null
  root: Renderable | null
  /**
   * Overlay/portal roots, painted after the main tree (low zIndex first) on top
   * of everything. Registered by node-ops when an `<overlay>` mounts.
   */
  overlays: Renderable[]
  theme: Theme
  /** Renderables whose layout style changed since the last layout pass. */
  dirtyLayout: Set<Renderable>
  /** Renderables whose text runs changed (re-flattened on paint). */
  dirtyText: Set<Renderable>
  /** URI → stable OSC 8 link id, staged to the renderer each frame before flush. */
  links: import('./link-registry.ts').LinkRegistry
  /** Active drag-selection over static `<text>`/`<markdown>` (highlight + copy). */
  selection: import('./selection.ts').HostSelection
  /** Renderer size at the last layout pass; a change (resize) forces a relayout. */
  layoutW: number
  layoutH: number
  scheduleRender: () => void
  flushNow: () => void
  dispose: () => void
  renderCount: number
  /**
   * Callbacks run after the layout pass and before paint, while rects are fresh.
   * Scroll viewports register here to clamp/stick their offset to the just-laid-
   * out content size (stick-to-bottom) with no one-frame lag. Mutate paint state
   * + `markDirty()` only — do NOT `scheduleRender()` (paint runs next this frame).
   */
  afterLayout: Set<() => void>
  /**
   * Subscribers notified once after each layout pass that actually recomputed
   * rects (the dirty-gated skip does NOT fire them). The subscription point behind
   * `useElementRect`: a callback re-measures its element's screen rect off the
   * fresh `rect`s. Fired by `runLayout`; mutate measurement state only — paint
   * runs next this frame, so a reactive write here coalesces into one repaint.
   */
  layoutListeners: Set<() => void>
  /** Layout pass (Phase 03); null until wired. */
  layout: ((ctx: HostContext) => void) | null
  /** Paint walk (Phase 04); null until wired. */
  paint: ((ctx: HostContext) => void) | null
  /** Keyboard focus model; wired at mount (null in offscreen-only tests). */
  focusManager: import('./focus.ts').HostFocusManager | null
  /**
   * Active animations (Phase: animation/timeline). The scheduler drives a frame
   * loop only while this is non-empty; each tween's `onUpdate` sets a reactive
   * ref → the existing coalesced render. Empty ⇒ zero-render-on-idle holds.
   */
  animations: AnimationRegistry
}

/**
 * Injection key for the per-app `HostContext`, provided at mount. Composables
 * like `useTimeline()` inject it to reach the animation registry/scheduler
 * without threading a host-element ref through the component.
 */
export const HostContextSymbol: InjectionKey<HostContext> = Symbol('vui-host-context')
