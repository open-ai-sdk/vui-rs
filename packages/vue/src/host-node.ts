// The host tree the Vue custom renderer mutates. It is a superset of the Rust
// render-node tree: `box`/`text` host nodes own a real Rust `VuiNode`, while
// `span` (inline run-style), `raw-text` (string vnodes) and `comment` (fragment
// anchors) are JS-only. Vue needs `parentNode`/`nextSibling` over *every* node,
// so the mirror tracks all of them; only the `box`/`text` subset is mirrored
// into Rust. Run text packs lazily: a `<text>` re-flattens its inline subtree to
// styled runs on flush, never on every keystroke.
import { type VuiNode as CoreNode, type VuiStyle, Renderer } from "@vui-rs/core";
import { markRaw } from "@vue/runtime-core";
import { lookup } from "./catalogue.ts";

export type HostNodeKind = "box" | "text" | "span" | "raw-text" | "comment";

/** Cached paint props on a node; companion values for the multi-arg Rust setters. */
export interface PaintCache {
  border: "none" | "single" | "double" | "rounded";
  borderColor?: number;
  title: string;
  titleAlign: "left" | "center" | "right";
  /** Explicitly-set attr bits, OR-ed with the boolean attr flags below. */
  baseAttrs: number;
  attrFlags: Record<string, number>;
}

/** Style a `span` contributes to its text-run children (folds down the chain). */
export interface RunStyle {
  fg?: number;
  bg?: number;
  attrs: number;
}

export interface VuiHostNode {
  /** The owning app context; carried on every node so `patchProp` can reach it. */
  ctx: VuiContext;
  kind: HostNodeKind;
  /** Original tag (`box`/`text`/`b`/`span`/…); `#text`/`#comment` for leaf nodes. */
  tag: string;
  /** Rust node for `box`/`text`; `null` for virtual (`span`/`raw-text`/`comment`). */
  core: CoreNode | null;
  parent: VuiHostNode | null;
  children: VuiHostNode[];
  /** Value for `raw-text`/`comment`. */
  text: string;
  /** Run-style for `span` nodes. */
  spanStyle: RunStyle;
  /** Accumulated layout style for `box`/`text`; flushed as one `setStyle`. */
  styleCache: VuiStyle;
  paint: PaintCache;
  /** `on*` handlers, stored for the input layer to dispatch (keyboard/focus). */
  events: Map<string, (...args: unknown[]) => void>;
  /** Unknown props, kept for debugging. */
  props: Record<string, unknown>;
  /** Single-string content set via `setElementText`; used only when no children. */
  directText: string | null;
}

/**
 * Per-app wiring shared by the renderer ops, patcher and scheduler. The core
 * `Renderer` is only known at mount, so it starts `null` and the ops assert it.
 */
export interface VuiContext {
  renderer: Renderer | null;
  root: VuiHostNode | null;
  /** `box`/`text` nodes whose `styleCache` changed — one `setStyle` each on flush. */
  dirtyStyle: Set<VuiHostNode>;
  /** `text` nodes whose runs changed — re-flattened + `setTextRuns` on flush. */
  dirtyText: Set<VuiHostNode>;
  /** Removed `box`/`text` nodes whose Rust node is freed after the current flush. */
  pendingFree: VuiHostNode[];
  /** Live Rust-backed nodes; must be empty after unmount (the leak guard). */
  liveNative: Set<VuiHostNode>;
  scheduleRender: () => void;
  /** Apply all staged mutations and render synchronously (mount/unmount/tests). */
  flushNow: () => void;
  /** Permanently stop the scheduler — no further renders (called on unmount). */
  dispose: () => void;
  /** Count of `render()` calls — instrumentation for the coalescing tests. */
  renderCount: number;
}

function newPaint(): PaintCache {
  return { border: "none", title: "", titleAlign: "left", baseAttrs: 0, attrFlags: {} };
}

function baseNode(
  ctx: VuiContext,
  kind: HostNodeKind,
  tag: string,
  core: CoreNode | null,
): VuiHostNode {
  return markRaw({
    ctx,
    kind,
    tag,
    core,
    parent: null,
    children: [],
    text: "",
    spanStyle: { attrs: 0 },
    styleCache: {},
    paint: newPaint(),
    events: new Map(),
    props: {},
    directText: null,
  });
}

/** Create a `box`/`text` (real Rust node) or virtual `span` host element. */
export function createHostElement(ctx: VuiContext, tag: string): VuiHostNode {
  const entry = lookup(tag);
  if (entry.kind === "span") {
    const node = baseNode(ctx, "span", tag, null);
    node.spanStyle.attrs = entry.spanAttrs;
    return node;
  }
  const renderer = requireRenderer(ctx);
  const core = renderer.createNode(entry.kind);
  const node = baseNode(ctx, entry.kind, tag, core);
  ctx.liveNative.add(node);
  return node;
}

/** Wrap the renderer's implicit root node as the mount container. */
export function createHostRoot(ctx: VuiContext, core: CoreNode): VuiHostNode {
  return baseNode(ctx, "box", "#root", core);
}

export function createHostText(ctx: VuiContext, text: string): VuiHostNode {
  const node = baseNode(ctx, "raw-text", "#text", null);
  node.text = text;
  return node;
}

export function createHostComment(ctx: VuiContext, text: string): VuiHostNode {
  const node = baseNode(ctx, "comment", "#comment", null);
  node.text = text;
  return node;
}

export function requireRenderer(ctx: VuiContext): Renderer {
  if (!ctx.renderer) throw new Error("vui: renderer not mounted yet");
  return ctx.renderer;
}

export function isNative(node: VuiHostNode): boolean {
  return node.kind === "box" || node.kind === "text";
}

/** Nearest enclosing `<text>` ancestor (inclusive), or null if outside one. */
export function enclosingText(node: VuiHostNode | null): VuiHostNode | null {
  for (let n = node; n; n = n.parent) {
    if (n.kind === "text") return n;
    if (n.kind === "box") return null; // a box breaks the text chain
  }
  return null;
}

/** First following sibling that is a Rust node — the anchor for `insertBefore`. */
export function nextNativeSiblingCore(node: VuiHostNode): CoreNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const at = parent.children.indexOf(node);
  for (let i = at + 1; i < parent.children.length; i++) {
    const sib = parent.children[i]!;
    if (sib.core) return sib.core;
  }
  return null;
}

/** Unlink a node from its current parent's child array (mirror only). */
export function detachFromParent(node: VuiHostNode): void {
  const parent = node.parent;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parent = null;
}
