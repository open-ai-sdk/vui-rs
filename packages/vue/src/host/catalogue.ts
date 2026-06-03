// The JS-host element catalogue: maps a Vue tag to a `Renderable` factory. This
// is the TresJS `catalogue`/`extend` pattern — `createElement(tag)` resolves
// `catalogue[tag]` and constructs the node. `box`/`text`/`input` map to their
// subclasses; the inline tags (`b/i/u/span`) build virtual `SpanRenderable`s.
// `extend()` registers custom kinds (the Phase 05 `<canvas>` and userland nodes).
import { Attr } from "@vui-rs/core";
import { BoxRenderable } from "./box-renderable.ts";
import { EditRenderable } from "./edit-renderable.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { SpanRenderable, TextRenderable } from "./text-renderable.ts";

/** Build a Renderable for `tag` in `ctx`. Custom entries supply their own factory. */
export type RenderableFactory = (ctx: HostContext, tag: string) => Renderable;

export interface CatalogueEntry {
  kind: Renderable["kind"];
  /** For `span` kinds: attribute bits the tag contributes (bold/italic/…). */
  spanAttrs: number;
  /** Custom constructor (Phase 05 `extend`); defaults to the built-in for `kind`. */
  make?: RenderableFactory;
}

const DEFAULT_CATALOGUE: Record<string, CatalogueEntry> = {
  box: { kind: "box", spanAttrs: 0 },
  text: { kind: "text", spanAttrs: 0 },
  input: { kind: "edit", spanAttrs: 0 },
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

/** Construct the Renderable for `tag` (custom `make` wins; else the built-in for `kind`). */
export function createRenderable(ctx: HostContext, tag: string): Renderable {
  const entry = lookup(tag);
  const node = entry.make ? entry.make(ctx, tag) : buildBuiltin(ctx, tag, entry);
  // box/text/edit get a layout-only native node (taffy style + text-for-measure;
  // no paint props). Created lazily only when a renderer is mounted, so pure
  // tree tests (no renderer) still build a Renderable graph with `layoutNode` null.
  if (ctx.renderer && (node.kind === "box" || node.kind === "text" || node.kind === "edit")) {
    node.layoutNode = ctx.renderer.createNode(node.kind);
  }
  return node;
}

function buildBuiltin(ctx: HostContext, tag: string, entry: CatalogueEntry): Renderable {
  switch (entry.kind) {
    case "box":
      return new BoxRenderable(ctx, tag);
    case "text":
      return new TextRenderable(ctx, tag);
    case "edit":
      return new EditRenderable(ctx, tag);
    case "span":
      return new SpanRenderable(ctx, tag, entry.spanAttrs);
    default:
      throw new Error(`vui: catalogue entry for <${tag}> has no built-in factory for kind "${entry.kind}"`);
  }
}
