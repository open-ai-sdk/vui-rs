// Flatten a `<text>` Renderable's inline subtree into ordered styled runs — the
// JS-host twin of the FFI `runs.ts`. Used to feed native text-buffer measure and
// render. Span style folds down the chain:
// `fg`/`bg` are overridden by inner spans, attrs are OR-combined.
import { LINK_SHIFT, type TextRun } from '@vui-rs/core'
import { type LinkRegistry } from './link-registry.ts'
import { type Renderable, type RunStyle } from './renderable.ts'

/**
 * Flatten a `<text>` Renderable's inline subtree into ordered styled runs. When a
 * `links` registry is passed, a run with a `link` target gets a stable link id
 * ORed into its `attrs` high byte (the emitter wraps those cells in OSC 8). The
 * registry is optional so measure-only callers and tests need not supply one.
 */
export function flattenRuns(textNode: Renderable, links?: LinkRegistry): TextRun[] {
  const out: TextRun[] = []
  collectRuns(textNode, { attrs: 0 }, out, links)
  return out
}

function collectRuns(node: Renderable, inherited: RunStyle, out: TextRun[], links?: LinkRegistry): void {
  // A leaf whose content was set via `setElementText` (Vue's text-children fast
  // path) carries it in `directText` rather than a child raw-text node.
  if (node.children.length === 0) {
    if (node.directText) out.push(makeRun(node.directText, inherited, links))
    return
  }
  for (const child of node.children) {
    if (child.kind === 'raw-text') {
      if (child.text.length > 0) out.push(makeRun(child.text, inherited, links))
    } else if (child.kind === 'span') {
      collectRuns(child, mergeStyle(inherited, child.spanStyle), out, links)
    }
    // comment children are inert; box/text are rejected at insert time.
  }
}

function mergeStyle(base: RunStyle, add: RunStyle): RunStyle {
  return {
    fg: add.fg ?? base.fg,
    bg: add.bg ?? base.bg,
    attrs: (base.attrs | add.attrs) >>> 0,
    // An inner span's link target overrides the enclosing one (nearest wins).
    link: add.link ?? base.link,
  }
}

function makeRun(text: string, style: RunStyle, links?: LinkRegistry): TextRun {
  const run: TextRun = { text }
  if (style.fg !== undefined) run.fg = style.fg
  if (style.bg !== undefined) run.bg = style.bg
  let attrs = style.attrs
  if (style.link !== undefined && links) {
    attrs = (attrs | (links.idFor(style.link) << LINK_SHIFT)) >>> 0
  }
  if (attrs) run.attrs = attrs
  return run
}
