// The named-color table — the SINGLE source of truth shared with Rust. Both
// `color.ts` (this package) and `crates/vui-core/src/color.rs` (`include_str!`)
// read `color-names.json`, so a name resolves to the same packed `0xRRGGBBAA`
// value on both sides. A parity test asserts the two parsers agree. Add or change
// a color in the JSON only — never hand-edit a per-language copy.
import table from './color-names.json' with { type: 'json' }

/** Parse a `#rgb`/`#rrggbb`/`#rrggbbaa` string to packed `0xRRGGBBAA`, or undefined. */
export function parseHex(value: string): number | undefined {
  if (!value.startsWith('#')) return undefined
  let hex = value.slice(1)
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  if (hex.length === 6) hex += 'ff'
  if (hex.length !== 8) return undefined
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return undefined
  return Number.parseInt(hex, 16) >>> 0
}

/** Named color → packed `0xRRGGBBAA`. Built once from the shared JSON table. */
export const NAMED_COLORS: ReadonlyMap<string, number> = new Map(
  Object.entries(table as Record<string, string>).map(([name, hex]) => {
    const packed = parseHex(hex)
    if (packed === undefined) throw new Error(`color-names.json: bad hex "${hex}" for "${name}"`)
    return [name, packed]
  }),
)
