// A tiny dependency-free fuzzy matcher. `fuzzyMatch` tests whether `query` is a
// (case-insensitive) subsequence of `text` and, when it is, returns a relevance
// `score` plus the matched character `indices` — the indices let a list highlight
// the letters that matched. `fuzzyFilter` ranks a list of items by that score,
// keeping only matches, best first. This is the lightweight stand-in for a
// `fuzzysort`-style library (opencode uses one); it is deliberately small and
// good-enough for command palettes, selects, and autocomplete over hundreds of
// items, not a million-row search engine.

/** A successful fuzzy match: a relevance score (higher is better) + matched char positions. */
export interface FuzzyMatch {
  score: number;
  indices: number[];
}

// Scoring weights. Tuned so that a contiguous, start-anchored, word-boundary
// match (e.g. "op" in "open file") beats a scattered one ("op" in "compose").
const BONUS_CONSECUTIVE = 8;
const BONUS_WORD_START = 10;
const BONUS_LEADING = 6;
const PENALTY_GAP = 1;

function isBoundary(ch: string): boolean {
  return ch === " " || ch === "-" || ch === "_" || ch === "/" || ch === "." || ch === ":";
}

/**
 * Greedy left-to-right subsequence match. Returns `null` when `query` is not a
 * subsequence of `text`. An empty query matches everything with score 0 (so an
 * empty search box shows the full list in its original order).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  let prevMatch = -2; // index of the previous matched char (for consecutiveness)
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    indices.push(ti);
    // Bonuses: consecutive run, start of a word, very start of the string.
    if (ti === prevMatch + 1) score += BONUS_CONSECUTIVE;
    if (ti === 0 || isBoundary(t[ti - 1]!)) score += BONUS_WORD_START;
    if (ti < 4) score += BONUS_LEADING - ti;
    score += 1;
    prevMatch = ti;
    qi++;
  }
  if (qi < q.length) return null; // ran out of text before matching all of query
  // Penalise long, spread-out matches a little (favour tight matches).
  const span = indices.length > 0 ? indices[indices.length - 1]! - indices[0]! : 0;
  score -= Math.max(0, span - indices.length) * PENALTY_GAP;
  return { score, indices };
}

/** An item ranked by `fuzzyFilter`: the original item plus its match metadata. */
export interface FuzzyRanked<T> {
  item: T;
  score: number;
  indices: number[];
}

/**
 * Filter + rank `items` against `query` by the text `key` returns for each item.
 * Non-matches are dropped; the rest come back best-score first. Ties keep the
 * original order (the sort is stable), so an empty query is an identity filter.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  key: (item: T) => string,
): Array<FuzzyRanked<T>> {
  const out: Array<FuzzyRanked<T>> = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) out.push({ item, score: m.score, indices: m.indices });
  }
  // Stable sort by descending score (Array.prototype.sort is stable in modern JS).
  out.sort((a, b) => b.score - a.score);
  return out;
}
