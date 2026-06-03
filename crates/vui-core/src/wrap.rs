//! Shared text-wrapping logic, used by BOTH the layout measure pass
//! (`node::measure_node`) and the paint pass (`paint::draw_runs`). Having one
//! function decide line breaks is the only way the measured box and the painted
//! glyphs can agree — if measure and paint each wrapped on their own, a one-cell
//! divergence would leave layout and render disagreeing (the #1 risk of
//! content-sizing).
//!
//! Line breaks depend ONLY on the width budget (cells), never on height. So a
//! caller that passes the same budget to `walk_runs` gets the same breaks; height
//! is just how many visual rows fell out, which each caller clips on its own
//! (paint by its content clip, measure by reporting the row count).

use crate::node::{TextRun, WrapMode};
use crate::width::char_width;
use unicode_segmentation::UnicodeSegmentation;

/// Width budget meaning "never wrap on width" — intrinsic max-content sizing and
/// the `NoWrap` mode both flow single-line until an explicit `\n`.
pub const UNBOUNDED: i64 = i64::MAX;

/// One placed glyph in the wrapped flow. `col`/`row` are offsets from the content
/// box origin (0-based, in cells); `run` indexes back into the source runs so the
/// painter can recover that span's fg/bg/attrs.
pub struct VisualCell {
    pub ch: char,
    /// Column span: 1, or 2 for a wide (CJK/emoji) glyph.
    pub width: u8,
    pub col: i64,
    pub row: i64,
    pub run: usize,
}

/// The measured content size in cells: the widest visual line and the line count.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Measured {
    pub width: f32,
    pub height: f32,
}

/// Walk `runs` at `width_budget` cells, invoking `emit` for every placeable glyph,
/// and return the measured `(width, height)`. In `Wrap` mode a glyph that would
/// cross the budget starts a new row (and one wider than the whole budget is
/// skipped, mirroring paint); in `NoWrap` mode only an explicit `\n` breaks a
/// line and glyphs run past the budget (the caller clips them). Even empty input
/// reports height 1, so an empty `<text>`/blank line still reserves its row.
pub fn walk_runs<F: FnMut(VisualCell)>(
    runs: &[TextRun],
    width_budget: i64,
    mode: WrapMode,
    mut emit: F,
) -> Measured {
    // A sub-one-cell wrap budget would put every glyph on its own row; clamp it so
    // a degenerate width can't explode the line count into the thousands.
    let budget = if mode == WrapMode::Wrap && width_budget < 1 {
        1
    } else {
        width_budget
    };
    let mut col: i64 = 0;
    let mut row: i64 = 0;
    let mut max_col: i64 = 0;
    for (run_idx, run) in runs.iter().enumerate() {
        for g in run.text.graphemes(true) {
            if g == "\n" {
                max_col = max_col.max(col);
                col = 0;
                row += 1;
                continue;
            }
            let Some(ch) = g.chars().next() else { continue };
            let w = char_width(ch).max(1) as i64;
            if mode == WrapMode::Wrap {
                // Wrap when the glyph (or its wide pair) would cross the budget.
                if col + w > budget {
                    max_col = max_col.max(col);
                    col = 0;
                    row += 1;
                }
                // Still over after wrapping: glyph is wider than the whole box; skip
                // it (paint does the same so the two stay in lockstep).
                if col + w > budget {
                    continue;
                }
            }
            emit(VisualCell {
                ch,
                width: w as u8,
                col,
                row,
                run: run_idx,
            });
            col += w;
        }
    }
    max_col = max_col.max(col);
    Measured {
        width: max_col as f32,
        height: (row + 1) as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str) -> TextRun {
        TextRun {
            text: text.into(),
            fg: None,
            bg: None,
            attrs: 0,
        }
    }

    /// Collect emitted cells as (ch, col, row) for easy assertions.
    fn cells(runs: &[TextRun], budget: i64, mode: WrapMode) -> (Vec<(char, i64, i64)>, Measured) {
        let mut out = Vec::new();
        let m = walk_runs(runs, budget, mode, |c| out.push((c.ch, c.col, c.row)));
        (out, m)
    }

    #[test]
    fn empty_input_is_zero_by_one() {
        let (out, m) = cells(&[], UNBOUNDED, WrapMode::Wrap);
        assert!(out.is_empty());
        assert_eq!(m, Measured { width: 0.0, height: 1.0 });
        // An empty run is the same: still one (blank) line.
        let (_o, m2) = cells(&[run("")], 10, WrapMode::Wrap);
        assert_eq!(m2, Measured { width: 0.0, height: 1.0 });
    }

    #[test]
    fn single_line_measures_width_and_one_row() {
        let (out, m) = cells(&[run("hello")], UNBOUNDED, WrapMode::Wrap);
        assert_eq!(out.len(), 5);
        assert_eq!(m, Measured { width: 5.0, height: 1.0 });
    }

    #[test]
    fn wraps_at_budget_and_reports_height() {
        // 5 graphemes into a 4-wide box => "abcd" / "e": 2 rows, width 4.
        let (out, m) = cells(&[run("abcde")], 4, WrapMode::Wrap);
        assert_eq!(out[3], ('d', 3, 0));
        assert_eq!(out[4], ('e', 0, 1));
        assert_eq!(m, Measured { width: 4.0, height: 2.0 });
    }

    #[test]
    fn explicit_newline_breaks_line() {
        let (out, m) = cells(&[run("a\nbc")], 80, WrapMode::Wrap);
        assert_eq!(out[0], ('a', 0, 0));
        assert_eq!(out[1], ('b', 0, 1));
        assert_eq!(out[2], ('c', 1, 1));
        assert_eq!(m, Measured { width: 2.0, height: 2.0 });
    }

    #[test]
    fn trailing_newline_reserves_an_empty_row() {
        let (_out, m) = cells(&[run("a\n")], 80, WrapMode::Wrap);
        assert_eq!(m.height, 2.0);
    }

    #[test]
    fn wide_glyph_counts_two_and_wraps_as_a_pair() {
        // '世' is 2 cells. Budget 3: "世a" fits (2+1=3); "b" wraps.
        let (out, m) = cells(&[run("世ab")], 3, WrapMode::Wrap);
        assert_eq!(out[0], ('世', 0, 0));
        assert_eq!(out[1], ('a', 2, 0));
        assert_eq!(out[2], ('b', 0, 1));
        assert_eq!(m, Measured { width: 3.0, height: 2.0 });
    }

    #[test]
    fn glyph_wider_than_budget_is_skipped() {
        // A wide glyph can't fit a 1-wide box: it's never emitted. It still bumps
        // the row exactly as paint does (wrap fires, then the skip) — measure must
        // match paint, so the empty box reports the same 2 rows paint would walk.
        let (out, m) = cells(&[run("世")], 1, WrapMode::Wrap);
        assert!(out.is_empty());
        assert_eq!(m.height, 2.0);
    }

    #[test]
    fn nowrap_ignores_budget_but_honours_newlines() {
        // No auto-wrap: the long line runs past the budget (caller clips on paint).
        let (out, m) = cells(&[run("abcdef\ngh")], 3, WrapMode::NoWrap);
        assert_eq!(out[5], ('f', 5, 0)); // never wrapped despite budget 3
        assert_eq!(out[6], ('g', 0, 1)); // explicit newline still breaks
        assert_eq!(m, Measured { width: 6.0, height: 2.0 });
    }

    #[test]
    fn run_index_tracks_source_span() {
        let runs = [run("ab"), run("cd")];
        let mut idx = Vec::new();
        walk_runs(&runs, 80, WrapMode::Wrap, |c| idx.push(c.run));
        assert_eq!(idx, vec![0, 0, 1, 1]);
    }
}
