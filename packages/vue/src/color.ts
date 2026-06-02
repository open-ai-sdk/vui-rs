// Color coercion for props. A packed `0xRRGGBBAA` number passes through; a
// `#rgb`/`#rrggbb`/`#rrggbbaa` string is parsed. `null`/`undefined` means "unset"
// (the paint setters fall back to defaults). An unparseable string would also
// read as "unset" and silently blank the color, so it warns in dev.

let warnedColors: Set<string> | null = null;

/** Coerce a prop value to a packed `0xRRGGBBAA` color, or `undefined` for unset. */
export function parseColor(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value >>> 0;
  if (typeof value === "string") {
    const parsed = parseHex(value);
    if (parsed !== undefined) return parsed;
    warnBadColor(value);
  }
  return undefined;
}

function parseHex(value: string): number | undefined {
  if (!value.startsWith("#")) return undefined;
  let hex = value.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8) return undefined;
  const n = Number.parseInt(hex, 16);
  return Number.isNaN(n) ? undefined : n >>> 0;
}

function warnBadColor(value: string): void {
  if (process.env.NODE_ENV === "production") return;
  warnedColors ??= new Set();
  if (warnedColors.has(value)) return;
  warnedColors.add(value);
  console.warn(`vui: unparseable color "${value}" — expected a number or #rrggbb(aa); treated as unset`);
}
