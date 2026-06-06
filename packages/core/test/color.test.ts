// Color parsing tests, including TS↔Rust parity. The named-color table is the
// single shared source `color-names.json` (Rust `include_str!`s the same file),
// so a name resolves to the same packed value on both sides. The format cases
// below (hex / rgb() / clamping) mirror the assertions in
// `crates/vui-core/src/color.rs` exactly — change them together.
import { describe, expect, test } from 'bun:test'
import { parseColor } from '../src/color.ts'
import { NAMED_COLORS, parseHex } from '../src/named-colors.ts'
import table from '../src/color-names.json' with { type: 'json' }

const u32 = (n: number) => n >>> 0

describe('parseColor', () => {
  test('passes a packed number through unchanged', () => {
    expect(parseColor(0x1234_5678)).toBe(0x1234_5678)
    expect(parseColor(0xffaa_bbcc)).toBe(u32(0xffaa_bbcc))
  })

  test('null/undefined are unset', () => {
    expect(parseColor(null)).toBeUndefined()
    expect(parseColor(undefined)).toBeUndefined()
  })

  // These exact (input → packed) pairs are mirrored in the Rust color tests.
  test.each<[string, number]>([
    ['#f00', 0xff0000ff],
    ['#00ff00', 0x00ff00ff],
    ['#0000ff80', 0x0000ff80],
    ['  #abc  ', 0xaabbccff],
    ['rgb(13, 188, 121)', 0x0dbc79ff],
    ['rgba(255,0,0,0.5)', 0xff000080],
    ['rgba(0,0,0,128)', 0x00000080],
    ['rgb(300, -5, 10)', 0xff000aff], // clamped to 0–255
    ['rgb(1e2, 0, 0)', 0x640000ff], // exponent form (=100), accepted by both
    ['teal', 0x008080ff],
    ['transparent', 0x00000000],
  ])('parses %s', (input, expected) => {
    expect(parseColor(input)).toBe(u32(expected))
  })

  test('is case-insensitive for names', () => {
    expect(parseColor('RoyalBlue')).toBe(parseColor('royalblue'))
  })

  test('unparseable strings are unset', () => {
    expect(parseColor('#xyz')).toBeUndefined()
    expect(parseColor('#12')).toBeUndefined()
    expect(parseColor('rgb(1,2)')).toBeUndefined()
    expect(parseColor('rgb(a,b,c)')).toBeUndefined()
    // Malformed channels that JS Number() would coerce but Rust rejects — the TS
    // parser is deliberately strict so the two stay in parity (mirrored in color.rs).
    expect(parseColor('rgb(1,2,)')).toBeUndefined() // empty channel
    expect(parseColor('rgb(0x10,0,0)')).toBeUndefined() // hex channel
    expect(parseColor('rgba(0,0,0,)')).toBeUndefined() // empty alpha
    expect(parseColor('definitelynotacolor')).toBeUndefined()
  })
})

describe('named-color table parity', () => {
  test('every name in the shared JSON parses to its hex value', () => {
    for (const [name, hex] of Object.entries(table as Record<string, string>)) {
      const expected = parseHex(hex)
      expect(expected).toBeDefined()
      expect(NAMED_COLORS.get(name)).toBe(expected!)
      expect(parseColor(name)).toBe(expected!)
    }
  })

  test('the curated table is non-trivial', () => {
    expect(NAMED_COLORS.size).toBeGreaterThanOrEqual(30)
  })
})
