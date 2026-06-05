// Unified-diff → classified lines the `<diff>` component colors. Pure (Vue-free)
// so it is unit-testable. A "patch" is the standard `git diff`/`diff -u` text:
// optional `diff --git`/`index` metadata, `---`/`+++` file headers, `@@ … @@`
// hunk headers, then `+`/`-`/space content lines. Old/new line numbers are tracked
// from each hunk header so the renderer can show a gutter.
export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content without the leading +/-/space marker. */
  text: string;
  /** 1-based line number in the old file (del/context), else undefined. */
  oldNo?: number;
  /** 1-based line number in the new file (add/context), else undefined. */
  newNo?: number;
}

// Capture both start numbers and the (optional, default 1) line counts: the
// counts tell us exactly when a hunk body ends, so file headers between hunks are
// never confused with content lines that happen to begin with `+`/`-` (e.g. a
// deleted line whose text is `-- x` renders as `--- x`).
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse a unified-diff patch into classified, line-numbered rows. */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  // Remaining old/new content lines expected in the current hunk; when both
  // reach zero the hunk is closed and following lines are metadata again.
  let oldRem = 0;
  let newRem = 0;
  let inHunk = false;

  // Drop a single trailing newline so a patch's terminating "\n" doesn't yield a
  // phantom empty final line (real `git diff` output is newline-terminated).
  const source = patch.endsWith("\n") ? patch.slice(0, -1) : patch;
  for (const raw of source.split("\n")) {
    // Drop a single trailing CR (CRLF patches) but keep intra-line content.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    const hunk = HUNK.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldRem = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newRem = hunk[4] === undefined ? 1 : Number(hunk[4]);
      inHunk = oldRem > 0 || newRem > 0;
      out.push({ kind: "hunk", text: line });
      continue;
    }

    // Outside any hunk body: file/section metadata (diff/index/---/+++).
    if (!inHunk) {
      out.push({ kind: "meta", text: line });
      continue;
    }

    // Inside a hunk, git's "\ No newline at end of file" note is not a content
    // line and carries no line number.
    if (line.startsWith("\\ ")) {
      out.push({ kind: "meta", text: line });
      continue;
    }

    const marker = line[0];
    const body = line.slice(1);
    if (marker === "+") {
      out.push({ kind: "add", text: body, newNo });
      newNo += 1;
      newRem -= 1;
    } else if (marker === "-") {
      out.push({ kind: "del", text: body, oldNo });
      oldNo += 1;
      oldRem -= 1;
    } else {
      // Context line (leading space) or a bare empty line inside the hunk.
      out.push({ kind: "context", text: body, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      oldRem -= 1;
      newRem -= 1;
    }
    if (oldRem <= 0 && newRem <= 0) inHunk = false;
  }
  return out;
}
