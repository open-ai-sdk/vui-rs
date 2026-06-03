// Phase 03: wrap.ts ↔ wrap.rs parity. A 1:1 port of the Rust `wrap::tests`
// corpus (same fixtures, same expected breaks/sizes). Because glyph widths come
// from the native `vui_char_width` — the exact source the Rust measure/paint
// uses — passing this corpus establishes measure/paint width parity, not just
// algorithm parity.
import { describe, expect, test } from "bun:test";
import { type Measured, type WrapMode, UNBOUNDED, walkRuns } from "../src/host/wrap.ts";

function run(text: string) {
  return { text };
}

/** Collect emitted cells as [ch, col, row] tuples + the measured size. */
function cells(
  runs: { text: string }[],
  budget: number,
  mode: WrapMode,
): { out: [string, number, number][]; m: Measured } {
  const out: [string, number, number][] = [];
  const m = walkRuns(runs, budget, mode, (c) => out.push([c.ch, c.col, c.row]));
  return { out, m };
}

describe("walkRuns (wrap.ts ↔ wrap.rs parity)", () => {
  test("empty input is zero by one", () => {
    const { out, m } = cells([], UNBOUNDED, "wrap");
    expect(out).toHaveLength(0);
    expect(m).toEqual({ width: 0, height: 1 });
    const { m: m2 } = cells([run("")], 10, "wrap");
    expect(m2).toEqual({ width: 0, height: 1 });
  });

  test("single line measures width and one row", () => {
    const { out, m } = cells([run("hello")], UNBOUNDED, "wrap");
    expect(out).toHaveLength(5);
    expect(m).toEqual({ width: 5, height: 1 });
  });

  test("wraps at budget and reports height", () => {
    const { out, m } = cells([run("abcde")], 4, "wrap");
    expect(out[3]).toEqual(["d", 3, 0]);
    expect(out[4]).toEqual(["e", 0, 1]);
    expect(m).toEqual({ width: 4, height: 2 });
  });

  test("explicit newline breaks line", () => {
    const { out, m } = cells([run("a\nbc")], 80, "wrap");
    expect(out[0]).toEqual(["a", 0, 0]);
    expect(out[1]).toEqual(["b", 0, 1]);
    expect(out[2]).toEqual(["c", 1, 1]);
    expect(m).toEqual({ width: 2, height: 2 });
  });

  test("trailing newline reserves an empty row", () => {
    const { m } = cells([run("a\n")], 80, "wrap");
    expect(m.height).toBe(2);
  });

  test("wide glyph counts two and wraps as a pair", () => {
    const { out, m } = cells([run("世ab")], 3, "wrap");
    expect(out[0]).toEqual(["世", 0, 0]);
    expect(out[1]).toEqual(["a", 2, 0]);
    expect(out[2]).toEqual(["b", 0, 1]);
    expect(m).toEqual({ width: 3, height: 2 });
  });

  test("glyph wider than budget is skipped (row still bumps)", () => {
    const { out, m } = cells([run("世")], 1, "wrap");
    expect(out).toHaveLength(0);
    expect(m.height).toBe(2);
  });

  test("nowrap ignores budget but honours newlines", () => {
    const { out, m } = cells([run("abcdef\ngh")], 3, "nowrap");
    expect(out[5]).toEqual(["f", 5, 0]);
    expect(out[6]).toEqual(["g", 0, 1]);
    expect(m).toEqual({ width: 6, height: 2 });
  });

  test("run index tracks source span", () => {
    const idx: number[] = [];
    walkRuns([run("ab"), run("cd")], 80, "wrap", (c) => idx.push(c.run));
    expect(idx).toEqual([0, 0, 1, 1]);
  });
});
