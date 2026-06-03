// Shared text-wrapping logic for the JS host — a 1:1 port of `crates/vui-core/
// src/wrap.rs`. Used by BOTH the JS measure (text auto-size, Phase 03) and the
// JS paint (`TextRenderable.renderSelf`, Phase 04). One function deciding line
// breaks is the only way the measured box and the painted glyphs agree; if
// measure and paint wrapped independently a one-cell divergence would desync
// layout and render. Glyph widths come from the native `charWidth`, the SAME
// source the Rust paint uses — so the port can't drift on width.
//
// Line breaks depend ONLY on the width budget (cells), never on height: the same
// budget yields the same breaks; height is just the row count that falls out.
import { charWidth } from "@vui-rs/core";

/** Width budget meaning "never wrap on width" (intrinsic max-content / NoWrap). */
export const UNBOUNDED = Number.MAX_SAFE_INTEGER;

export type WrapMode = "wrap" | "nowrap";

/** A run of text sharing one style; `wrap` only needs the text + its run index. */
export interface WrapRun {
  text: string;
}

/** One placed glyph in the wrapped flow. `col`/`row` are content-box offsets. */
export interface VisualCell {
  ch: string;
  /** Column span: 1, or 2 for a wide (CJK/emoji) glyph. */
  width: number;
  col: number;
  row: number;
  /** Index back into the source runs (recover that span's fg/bg/attrs). */
  run: number;
}

/** Measured content size in cells: widest visual line + line count. */
export interface Measured {
  width: number;
  height: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Graphemes of `text` (matches Rust `UnicodeSegmentation::graphemes(true)` closely). */
function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) out.push(seg.segment);
  return out;
}

/**
 * Walk `runs` at `widthBudget` cells, calling `emit` for every placeable glyph,
 * returning the measured `(width, height)`. In `wrap` mode a glyph that would
 * cross the budget starts a new row (one wider than the whole budget is skipped,
 * mirroring paint); in `nowrap` mode only an explicit `\n` breaks a line and
 * glyphs run past the budget (the caller clips). Empty input reports height 1,
 * so a blank line still reserves its row. A 1:1 port of `wrap.rs::walk_runs`.
 */
export function walkRuns(
  runs: readonly WrapRun[],
  widthBudget: number,
  mode: WrapMode,
  emit: (cell: VisualCell) => void,
): Measured {
  // A sub-one-cell wrap budget would put every glyph on its own row; clamp so a
  // degenerate width can't explode the line count.
  const budget = mode === "wrap" && widthBudget < 1 ? 1 : widthBudget;
  let col = 0;
  let row = 0;
  let maxCol = 0;
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    for (const g of graphemes(runs[runIdx]!.text)) {
      if (g === "\n") {
        maxCol = Math.max(maxCol, col);
        col = 0;
        row += 1;
        continue;
      }
      const cp = g.codePointAt(0);
      if (cp === undefined) continue;
      const ch = String.fromCodePoint(cp);
      const w = Math.max(charWidth(cp), 1);
      if (mode === "wrap") {
        // Wrap when the glyph (or its wide pair) would cross the budget.
        if (col + w > budget) {
          maxCol = Math.max(maxCol, col);
          col = 0;
          row += 1;
        }
        // Still over after wrapping: wider than the whole box; skip it (paint
        // does the same, so the two stay in lockstep).
        if (col + w > budget) continue;
      }
      emit({ ch, width: w, col, row, run: runIdx });
      col += w;
    }
  }
  maxCol = Math.max(maxCol, col);
  return { width: maxCol, height: row + 1 };
}

/** Convenience: just the measured size (no glyph emission). */
export function measureRuns(runs: readonly WrapRun[], widthBudget: number, mode: WrapMode): Measured {
  return walkRuns(runs, widthBudget, mode, () => {});
}
