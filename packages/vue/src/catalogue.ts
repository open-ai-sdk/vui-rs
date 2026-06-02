// The element catalogue: maps a Vue tag to a host node kind. `box`/`text` become
// real Rust nodes; the inline tags (`b/i/u/span`) are *virtual* run-style
// contributors — they own no Rust node and only fold style into the runs of the
// enclosing `<text>`. `extend()` lets downstream code register custom element kinds.
import { Attr } from "@vui-rs/core";

/** Host kind an element tag resolves to. `span` kinds are virtual (no Rust node). */
export type HostKind = "box" | "text" | "span";

export interface CatalogueEntry {
  kind: HostKind;
  /** For `span` kinds: attribute bits this tag contributes (bold/italic/…). */
  spanAttrs: number;
}

const DEFAULT_CATALOGUE: Record<string, CatalogueEntry> = {
  box: { kind: "box", spanAttrs: 0 },
  text: { kind: "text", spanAttrs: 0 },
  // Inline run-style tags. `span` carries no implicit attrs (style comes from props).
  span: { kind: "span", spanAttrs: 0 },
  b: { kind: "span", spanAttrs: Attr.BOLD },
  strong: { kind: "span", spanAttrs: Attr.BOLD },
  i: { kind: "span", spanAttrs: Attr.ITALIC },
  em: { kind: "span", spanAttrs: Attr.ITALIC },
  u: { kind: "span", spanAttrs: Attr.UNDERLINE },
};

const catalogue: Record<string, CatalogueEntry> = { ...DEFAULT_CATALOGUE };

/** Register custom element kinds for extensibility. Overrides existing tags. */
export function extend(map: Record<string, CatalogueEntry>): void {
  Object.assign(catalogue, map);
}

/** Resolve a tag to its catalogue entry; an unknown tag is a hard error. */
export function lookup(tag: string): CatalogueEntry {
  const entry = catalogue[tag];
  if (!entry) {
    throw new Error(`vui: unknown element <${tag}>. Register it with extend() first.`);
  }
  return entry;
}
