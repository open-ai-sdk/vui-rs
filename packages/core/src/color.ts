// Color coercion for the public API. A packed `0xRRGGBBAA` number passes through;
// strings are parsed as `#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb()/rgba()` functional
// notation, or a named color (shared table — see `named-colors.ts`). `null`/
// `undefined` means "unset" (paint setters fall back to defaults). An unparseable
// string also reads as "unset" — it would silently blank the color, so it warns
// in dev. Colors are resolved to u32 HERE, in TS; Rust only ever receives the
// packed value over FFI (it never parses color strings at runtime).
import { NAMED_COLORS, parseHex } from './named-colors.ts'

let warnedColors: Set<string> | null = null

/** Coerce a prop value to a packed `0xRRGGBBAA` color, or `undefined` for unset. */
export function parseColor(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value === 'number') return value >>> 0
  if (typeof value === 'string') {
    const parsed = parseColorString(value.trim())
    if (parsed !== undefined) return parsed
    warnBadColor(value)
  }
  return undefined
}

function parseColorString(value: string): number | undefined {
  if (value.startsWith('#')) return parseHex(value)
  if (value.startsWith('rgb')) return parseRgbFunction(value)
  return NAMED_COLORS.get(value.toLowerCase())
}

// `rgb(r, g, b)` / `rgba(r, g, b, a)`. Channels are 0–255; alpha is 0–255 or a
// 0–1 fraction (web style). Anything malformed returns undefined (→ warn/unset).
function parseRgbFunction(value: string): number | undefined {
  const open = value.indexOf('(')
  if (open < 0 || !value.endsWith(')')) return undefined
  const parts = value
    .slice(open + 1, -1)
    .split(',')
    .map((p) => p.trim())
  if (parts.length < 3 || parts.length > 4) return undefined
  const r = channel(parts[0]!)
  const g = channel(parts[1]!)
  const b = channel(parts[2]!)
  if (r === undefined || g === undefined || b === undefined) return undefined
  let a = 255
  if (parts.length === 4) {
    const raw = decimal(parts[3]!)
    if (raw === undefined) return undefined
    a = raw <= 1 ? Math.round(raw * 255) : Math.round(raw)
  }
  return ((r << 24) | (g << 16) | (b << 8) | clamp255(a)) >>> 0
}

function channel(s: string): number | undefined {
  const n = decimal(s)
  return n === undefined ? undefined : clamp255(Math.round(n))
}

// Only finite decimal numbers, matching what Rust's `f64::parse` accepts in the
// reference parser (no hex `0x10`, no empty string, no `inf`/`nan`). JS `Number()`
// alone is too permissive — it would coerce `""→0` and `"0x10"→16`, silently
// disagreeing with Rust. Keeping the grammars identical preserves color parity.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

function decimal(s: string): number | undefined {
  if (!DECIMAL.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : n
}

function warnBadColor(value: string): void {
  if (process.env.NODE_ENV === 'production') return
  warnedColors ??= new Set()
  if (warnedColors.has(value)) return
  warnedColors.add(value)
  console.warn(
    `vui: unparseable color "${value}" — expected a number, #rrggbb(aa), rgb()/rgba(), or a named color; treated as unset`,
  )
}
