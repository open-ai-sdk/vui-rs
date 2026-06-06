// The JS-host element catalogue: maps a Vue tag to a `Renderable` factory. This
// is the TresJS `catalogue`/`extend` pattern — `createElement(tag)` resolves
// `catalogue[tag]` and constructs the node. `box`/`text`/`input` map to their
// subclasses; the inline tags (`b/i/u/span`) build virtual `SpanRenderable`s.
// `extend()` registers custom kinds (the `<canvas>` and userland nodes).
import { Attr } from "@vui-rs/core";
import { BoxRenderable } from "./box-renderable.ts";
import { CanvasRenderable } from "./canvas-renderable.ts";
import { EditRenderable } from "./edit-renderable.ts";
import { ImageRenderable } from "./image-renderable.ts";
import { OverlayRenderable } from "./overlay.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { TextareaRenderable } from "./textarea-renderable.ts";
import { SpanRenderable, TextRenderable } from "./text-renderable.ts";

/** Build a Renderable for `tag` in `ctx`. Custom entries supply their own factory. */
export type RenderableFactory = (ctx: HostContext, tag: string) => Renderable;

export interface CatalogueEntry {
  kind: Renderable["kind"];
  /** For `span` kinds: attribute bits the tag contributes (bold/italic/…). */
  spanAttrs: number;
  /** Custom constructor (from `extend`); defaults to the built-in for `kind`. */
  make?: RenderableFactory;
}

const DEFAULT_CATALOGUE: Record<string, CatalogueEntry> = {
  box: { kind: "box", spanAttrs: 0 },
  text: { kind: "text", spanAttrs: 0 },
  input: { kind: "edit", spanAttrs: 0 },
  "textarea-host": { kind: "textarea", spanAttrs: 0 },
  // First-class custom drawing: a leaf box whose `@draw` paints freely, clipped.
  canvas: { kind: "box", spanAttrs: 0, make: (ctx, tag) => new CanvasRenderable(ctx, tag) },
  // Inline image: a leaf box that decodes `src` and paints it (half-block today).
  image: { kind: "box", spanAttrs: 0, make: (ctx, tag) => new ImageRenderable(ctx, tag) },
  // Top-layer box (modal/dialog/toast): hoisted over the tree by the overlay pass.
  overlay: { kind: "box", spanAttrs: 0, make: (ctx, tag) => new OverlayRenderable(ctx, tag) },
  span: { kind: "span", spanAttrs: 0 },
  b: { kind: "span", spanAttrs: Attr.BOLD },
  strong: { kind: "span", spanAttrs: Attr.BOLD },
  i: { kind: "span", spanAttrs: Attr.ITALIC },
  em: { kind: "span", spanAttrs: Attr.ITALIC },
  u: { kind: "span", spanAttrs: Attr.UNDERLINE },
};

const catalogue: Record<string, CatalogueEntry> = { ...DEFAULT_CATALOGUE };

/** Register custom element kinds. Overrides existing tags. */
export function extend(map: Record<string, CatalogueEntry>): void {
  Object.assign(catalogue, map);
}

/** Resolve a tag to its entry; an unknown tag is a hard error. */
export function lookup(tag: string): CatalogueEntry {
  const entry = catalogue[tag];
  if (!entry) {
    throw new Error(`vui: unknown element <${tag}>. Register it with extend() first.`);
  }
  return entry;
}

/**
 * Is `tag` a vui *element* (vs. a Vue component) for the SFC compiler's
 * `isCustomElement`? `box`/`text`/`canvas` and the inline `span`-kind tags are
 * elements; `edit`-kind tags (`<input>`) are NOT — they resolve to the
 * `VuiHostInput` component (registered at app create) so v-model round-trips
 * through its editing logic. `textarea-host` is the internal element rendered by
 * the public `<textarea>` component. Only knows built-in + `extend()`-ed tags in THIS
 * process; the Vite build lists runtime tags in the plugin separately.
 */
export function isVuiTag(tag: string): boolean {
  const entry = catalogue[tag];
  return entry !== undefined && entry.kind !== "edit";
}

/** Construct the Renderable for `tag` (custom `make` wins; else the built-in for `kind`). */
export function createRenderable(ctx: HostContext, tag: string): Renderable {
  const entry = lookup(tag);
  const node = entry.make ? entry.make(ctx, tag) : buildBuiltin(ctx, tag, entry);
  // box/text/edit get a layout-only native node (taffy style + text-for-measure;
  // no paint props). Created lazily only when a renderer is mounted, so pure
  // tree tests (no renderer) still build a Renderable graph with `layoutNode` null.
  if (ctx.renderer && (node.kind === "box" || node.kind === "text" || node.kind === "edit" || node.kind === "textarea")) {
    node.layoutNode = ctx.renderer.createNode(node.kind === "textarea" ? "edit" : node.kind);
  }
  return node;
}

// An unstyled node's colors are NOT seeded here: paint reads the app theme live
// (`paint.fg ?? ctx.theme.fg`, border ← `ctx.theme.border`), so a runtime
// `setTheme()` recolors every default element with no remount. Explicit
// `fg`/`bg`/`borderColor` props (applied by patch-prop) still win at paint time.

function buildBuiltin(ctx: HostContext, tag: string, entry: CatalogueEntry): Renderable {
  switch (entry.kind) {
    case "box":
      return new BoxRenderable(ctx, tag);
    case "text":
      return new TextRenderable(ctx, tag);
    case "edit":
      return new EditRenderable(ctx, tag);
    case "textarea":
      return new TextareaRenderable(ctx, tag);
    case "span":
      return new SpanRenderable(ctx, tag, entry.spanAttrs);
    default:
      throw new Error(`vui: catalogue entry for <${tag}> has no built-in factory for kind "${entry.kind}"`);
  }
}
