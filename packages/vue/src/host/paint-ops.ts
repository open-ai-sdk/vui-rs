// The JS twins of paint.rs's draw helpers — fill, border ring + title, wrapped
// text runs, and the single-line edit. Every write goes through the PaintBuffer
// (clip-aware native prims); a "transparent" cell (no node/run bg) keeps the
// background already under it via `bgUnder`, exactly like paint.rs. Line breaks
// come from the shared `wrap.ts` so painted glyphs land where layout measured.
import { Attr, charWidth } from "@vui-rs/core";
import type { TextRun } from "@vui-rs/core";
import { type EditState } from "./edit-renderable.ts";
import { type Clip, type PaintBuffer, type PaintCtx, type PaintProps } from "./renderable.ts";
import { type WrapMode, walkRuns } from "./wrap.ts";

export const DEFAULT_FG = 0xe5e5e5ff;
export const DEFAULT_BG = 0x000000ff;

export type BorderStyle = "single" | "double" | "rounded";
export type TitleAlign = "left" | "center" | "right";

interface BorderGlyphs {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

const BORDERS: Record<BorderStyle, BorderGlyphs> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) out.push(seg.segment);
  return out;
}

const cp = (g: string): number => g.codePointAt(0) ?? 0;
const gWidth = (g: string): number => Math.max(charWidth(cp(g)), 1);

/** `put`: write a cell (the buffer clips it). The JS twin of paint.rs `put`. */
function put(buf: PaintBuffer, clip: Clip, x: number, y: number, ch: number, fg: number, bg: number, attrs: number): void {
  buf.setCell(x, y, ch, fg, bg, attrs, clip);
}

/** Opaque background fill of the node box (paint.rs `fill`). */
export function drawFill(buf: PaintBuffer, clip: Clip, x0: number, y0: number, x1: number, y1: number, bg: number): void {
  if (x1 <= x0 || y1 <= y0) return;
  buf.fillRect(x0, y0, x1 - x0, y1 - y0, bg, clip);
}

/**
 * The chrome every box/text/edit node shares: background fill, then border ring +
 * title. The common prefix of paint.rs `paint_node` before the kind-specific
 * content. `renderSelf` calls this, then draws its own content (runs / edit).
 */
export function drawChrome(buf: PaintBuffer, ctx: PaintCtx, paint: PaintProps): void {
  const { x0, y0, x1, y1, clip } = ctx;
  if (paint.bg !== undefined) drawFill(buf, clip, x0, y0, x1, y1, paint.bg);
  if (paint.border !== "none") {
    const color = paint.borderColor ?? paint.fg ?? DEFAULT_FG;
    drawBorder(buf, clip, x0, y0, x1, y1, paint.border, color, paint.bg);
    if (paint.title) {
      drawTitle(buf, clip, x0, x1, y0, paint.title, paint.fg ?? DEFAULT_FG, paint.bg, paint.titleAlign);
    }
  }
}

/** Border ring (paint.rs `draw_border`). `nodeBg` undefined → transparent (keep bg under). */
export function drawBorder(
  buf: PaintBuffer,
  clip: Clip,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: BorderStyle,
  fg: number,
  nodeBg: number | undefined,
): void {
  if (x1 - x0 < 2 || y1 - y0 < 2) return; // too small to frame
  const g = BORDERS[style];
  const bgAt = (x: number, y: number): number => nodeBg ?? buf.bgUnder(x, y);
  const right = x1 - 1;
  const bottom = y1 - 1;
  const innerW = right - (x0 + 1);
  if (innerW > 0) {
    if (nodeBg !== undefined) {
      // Opaque bg → the whole horizontal run is one style: draw it in a single
      // FFI op per row instead of one per cell (the dominant cost for wide boxes).
      // Cell-for-cell identical to the per-cell loop (same ch/fg/bg/attrs).
      const hrun = g.h.repeat(innerW);
      buf.drawText(x0 + 1, y0, hrun, fg, nodeBg, 0, clip);
      buf.drawText(x0 + 1, bottom, hrun, fg, nodeBg, 0, clip);
    } else {
      // Transparent: each cell keeps the (varying) bg under it — must go per-cell.
      for (let x = x0 + 1; x < right; x++) {
        put(buf, clip, x, y0, cp(g.h), fg, buf.bgUnder(x, y0), 0);
        put(buf, clip, x, bottom, cp(g.h), fg, buf.bgUnder(x, bottom), 0);
      }
    }
  }
  for (let y = y0 + 1; y < bottom; y++) {
    put(buf, clip, x0, y, cp(g.v), fg, bgAt(x0, y), 0);
    put(buf, clip, right, y, cp(g.v), fg, bgAt(right, y), 0);
  }
  put(buf, clip, x0, y0, cp(g.tl), fg, bgAt(x0, y0), 0);
  put(buf, clip, right, y0, cp(g.tr), fg, bgAt(right, y0), 0);
  put(buf, clip, x0, bottom, cp(g.bl), fg, bgAt(x0, bottom), 0);
  put(buf, clip, right, bottom, cp(g.br), fg, bgAt(right, bottom), 0);
}

/** Title on the top border row, inside the corners, aligned (paint.rs `draw_title`). */
export function drawTitle(
  buf: PaintBuffer,
  clip: Clip,
  x0: number,
  x1: number,
  y0: number,
  title: string,
  fg: number,
  nodeBg: number | undefined,
  align: TitleAlign,
): void {
  const innerLeft = x0 + 1;
  const innerRight = x1 - 1; // exclusive
  const avail = innerRight - innerLeft;
  if (avail <= 0) return;
  const gs = graphemes(title);
  const titleW = gs.reduce((n, g) => n + gWidth(g), 0);
  let start: number;
  if (align === "right") start = innerRight - titleW;
  else if (align === "center") start = innerLeft + Math.trunc((avail - titleW) / 2);
  else start = innerLeft;
  start = Math.max(start, innerLeft);
  drawLine(buf, clip, start, innerRight, y0, gs, fg, nodeBg);
}

/** Wrapped multi-run text (paint.rs `draw_runs`), using the shared wrap logic. */
export function drawRuns(
  buf: PaintBuffer,
  clip: Clip,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  runs: TextRun[],
  paint: PaintProps,
): void {
  if (cx1 <= cx0 || cy1 <= cy0) return;
  const budget = cx1 - cx0;
  const mode: WrapMode = paint.wrap;
  walkRuns(runs, budget, mode, (cell) => {
    const row = cy0 + cell.row;
    if (row >= cy1) return; // below the content box
    const col = cx0 + cell.col;
    const run = runs[cell.run]!;
    const fg = run.fg ?? paint.fg ?? DEFAULT_FG;
    const attrs = paint.attrs | (run.attrs ?? 0);
    const bg = run.bg ?? paint.bg ?? buf.bgUnder(col, row);
    put(buf, clip, col, row, cp(cell.ch), fg, bg, attrs);
    if (cell.width === 2) {
      put(buf, clip, col + 1, row, 0, fg, bg, attrs | Attr.WIDE_CONTINUATION);
    }
  });
}

/** Single-line text from `start`, clipped to `[start,end)` on row `y` (paint.rs `draw_line`). */
export function drawLine(
  buf: PaintBuffer,
  clip: Clip,
  start: number,
  end: number,
  y: number,
  gs: string[],
  fg: number,
  bg: number | undefined,
): void {
  let col = start;
  for (const g of gs) {
    const w = gWidth(g);
    if (col + w > end) break;
    const cellBg = bg ?? buf.bgUnder(col, y);
    put(buf, clip, col, y, cp(g), fg, cellBg, 0);
    if (w === 2) put(buf, clip, col + 1, y, 0, fg, cellBg, Attr.WIDE_CONTINUATION);
    col += w;
  }
}

/** `(leadingChar, width)` per grapheme — the form `drawGlyphs` consumes. */
export function glyphCells(s: string): Array<[number, number]> {
  return graphemes(s).map((g) => [cp(g), gWidth(g)] as [number, number]);
}

/** Single-line `<input>`: value/placeholder + block cursor (paint.rs `draw_edit`). */
export function drawEdit(
  buf: PaintBuffer,
  clip: Clip,
  cx0: number,
  cy0: number,
  cx1: number,
  edit: EditState,
  paint: PaintProps,
): void {
  const width = cx1 - cx0;
  if (width <= 0) return;
  const row = cy0;
  const fg = paint.fg ?? DEFAULT_FG;
  const valGs = graphemes(edit.value);
  let cursorCol = 0;
  for (let i = 0; i < edit.cursor && i < valGs.length; i++) cursorCol += gWidth(valGs[i]!);
  // Scroll so the cursor stays on screen once the value overflows the content box.
  const scroll = cursorCol >= width ? cursorCol - width + 1 : 0;

  if (edit.value === "") {
    if (edit.placeholder !== "") {
      const color = edit.placeholderColor ?? fg;
      const attrs = edit.placeholderColor !== undefined ? 0 : Attr.DIM;
      drawGlyphs(buf, clip, cx0, cx1, row, glyphCells(edit.placeholder), 0, color, paint.bg, attrs);
    }
  } else {
    drawGlyphs(buf, clip, cx0, cx1, row, glyphCells(edit.value), scroll, fg, paint.bg, paint.attrs);
  }

  if (edit.focused) {
    const sx = cx0 + cursorCol - scroll;
    if (sx >= cx0 && sx < cx1) {
      const underG = valGs[edit.cursor];
      const underCp = underG ? cp(underG) : 32; // ' '
      const wide = Math.max(charWidth(underCp), 1) === 2 && sx + 1 < cx1;
      let cfg: number;
      let cbg: number;
      const cattrs = paint.attrs | (edit.cursorColor !== undefined ? 0 : Attr.INVERSE);
      if (edit.cursorColor !== undefined) {
        cfg = paint.bg ?? DEFAULT_BG;
        cbg = edit.cursorColor;
      } else {
        cfg = fg;
        cbg = paint.bg ?? buf.bgUnder(sx, row);
      }
      put(buf, clip, sx, row, underCp, cfg, cbg, cattrs);
      if (wide) put(buf, clip, sx + 1, row, 0, cfg, cbg, cattrs | Attr.WIDE_CONTINUATION);
    }
  }
}

/**
 * Draw `cells` on `row` from `cx0`, dropping the leading `scroll` columns and
 * clipping at `cx1`; a wide glyph bisected by the scroll edge is skipped. The JS
 * twin of paint.rs `draw_glyphs` (the `<input>` value/placeholder renderer).
 */
export function drawGlyphs(
  buf: PaintBuffer,
  clip: Clip,
  cx0: number,
  cx1: number,
  row: number,
  cells: Array<[number, number]>,
  scroll: number,
  fg: number,
  bg: number | undefined,
  attrs: number,
): void {
  let col = 0;
  for (const [ch, w] of cells) {
    if (col + w <= scroll) {
      col += w;
      continue;
    }
    const sx = cx0 + col - scroll;
    if (sx >= cx1) break;
    if (sx < cx0) {
      col += w;
      continue;
    }
    const cellBg = bg ?? buf.bgUnder(sx, row);
    put(buf, clip, sx, row, ch, fg, cellBg, attrs);
    if (w === 2 && sx + 1 < cx1) put(buf, clip, sx + 1, row, 0, fg, cellBg, attrs | Attr.WIDE_CONTINUATION);
    col += w;
  }
}
