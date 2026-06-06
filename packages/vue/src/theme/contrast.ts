// Contrast helpers: pick a readable foreground for a given background by its
// perceived luminance. Selected-foreground rule (luminance >
// 0.5 ⇒ use a dark fg, else light). Colors are packed `0xRRGGBBAA`.

/** Perceived luminance (0–1) of a packed color, ITU-R BT.601 weights. */
export function luminance(packed: number): number {
  const c = packed >>> 0;
  const r = ((c >>> 24) & 0xff) / 255;
  const g = ((c >>> 16) & 0xff) / 255;
  const b = ((c >>> 8) & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Whether a background reads as "light" (luminance above the midpoint). */
export function isLight(packed: number): boolean {
  return luminance(packed) > 0.5;
}

const BLACK = 0x000000ff;
const WHITE = 0xffffffff;

/**
 * Choose a foreground color that contrasts with `bg`. On a light background returns
 * `dark` (default black); on a dark background returns `light` (default white).
 */
export function pickForeground(
  bg: number,
  opts: { light?: number; dark?: number } = {},
): number {
  return isLight(bg) ? (opts.dark ?? BLACK) : (opts.light ?? WHITE);
}
