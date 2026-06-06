// Terminal column width of a codepoint (0/1/2), delegated to the native
// `vui_char_width` so the JS host measures glyphs with the EXACT same source as
// the Rust measure/paint — no parallel Unicode table to drift. Results are
// memoized per codepoint, so each distinct glyph crosses the FFI boundary at
// most once; after warm-up this is a Map lookup.
import { loadNativeLib } from './native/load-native-lib.ts'

const cache = new Map<number, number>()
let lib: ReturnType<typeof loadNativeLib> | null = null

/** Column width of a single codepoint: 0 (combining/control), 1, or 2. */
export function charWidth(cp: number): number {
  const hit = cache.get(cp)
  if (hit !== undefined) return hit
  lib ??= loadNativeLib()
  const w = lib.symbols.vui_char_width(cp >>> 0)
  cache.set(cp, w)
  return w
}

/** Width of a single-codepoint string's leading codepoint (`charWidth` for graphemes). */
export function strWidth(ch: string): number {
  const cp = ch.codePointAt(0)
  return cp === undefined ? 0 : charWidth(cp)
}
