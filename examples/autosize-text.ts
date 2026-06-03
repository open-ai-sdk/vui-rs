#!/usr/bin/env bun
// Auto-size text demo (Phase 02): every <text> here sizes itself to its content
// via taffy's measure callback — NONE set an explicit width/height. Before Phase
// 02 each of these would have collapsed to 0×0. Shows three things the measure
// pass unlocks:
//   A. boxes that hug their text (content-sized "buttons")
//   B. wrap (default) vs nowrap on the same narrow width
//   C. a fixed-width box whose auto height grows to fit wrapped + \n content
//
// Immediate-mode (Renderer + node tree, no Vue) so the layout is deterministic.
// Terminal setup/teardown mirrors layout-tree.ts; restores on every exit path.
import { Renderer, rgba } from "@vui-rs/core";

const width = process.stdout.columns ?? 80;
const height = process.stdout.rows ?? 24;
// Render-once-and-exit when not a TTY (CI / piped), else wait for a key.
const HOLD_MS = Number(process.env.VUI_HOLD_MS ?? (process.stdin.isTTY ? 30_000 : 400));

const enterAltScreen = () => process.stdout.write("\x1b[?1049h\x1b[?25l");
const leaveAltScreen = () => process.stdout.write("\x1b[?25h\x1b[?1049l");

let restored = false;
function restore(): void {
  if (restored) return;
  restored = true;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  leaveAltScreen();
}

function waitForKey(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      process.stdin.off("data", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", done);
  });
}

process.on("exit", restore);
process.on("SIGINT", () => (restore(), process.exit(0)));
process.on("SIGTERM", () => (restore(), process.exit(0)));
process.on("uncaughtException", (err) => {
  restore();
  console.error(err);
  process.exit(1);
});

// Catppuccin-ish palette.
const base = rgba(30, 30, 46);
const surface = rgba(49, 50, 68);
const accent = rgba(137, 180, 250);
const green = rgba(166, 227, 161);
const pink = rgba(245, 194, 231);
const text = rgba(205, 214, 244);
const subtle = rgba(127, 132, 156);

const renderer = new Renderer(width, height);

/** A bordered box that hugs its text — no explicit width/height anywhere. */
function badge(label: string, color: number): ReturnType<typeof renderer.createNode> {
  const box = renderer.createNode("box");
  box
    .setStyle({ border: 1, padding: { left: 1, right: 1 } })
    .setBg(surface)
    .setBorder("rounded", color);
  const t = renderer.createNode("text");
  t.setText(label).setFg(color);
  box.appendChild(t);
  return box;
}

/** A fixed-width titled box holding one text; the box's height is left to auto. */
function widthBox(title: string, w: number, color: number): {
  box: ReturnType<typeof renderer.createNode>;
  textNode: ReturnType<typeof renderer.createNode>;
} {
  const box = renderer.createNode("box");
  box
    .setStyle({ width: w, border: 1, padding: 1 })
    .setBg(surface)
    .setBorder("single", color)
    .setTitle(` ${title} `, "left");
  const textNode = renderer.createNode("text");
  box.appendChild(textNode);
  return { box, textNode };
}

/** A plain caption row (auto-sized text, no box). */
function caption(label: string): ReturnType<typeof renderer.createNode> {
  return renderer.createNode("text").setText(label).setFg(subtle);
}

/** A horizontal row container; alignItems:start so children keep their own size. */
function row(gap: number): ReturnType<typeof renderer.createNode> {
  return renderer.createNode("box").setStyle({ flexDirection: "row", gap, alignItems: "start" });
}

try {
  enterAltScreen();

  const root = renderer.rootNode();
  // Column, gap between sections; alignItems:start so each child hugs its content
  // width instead of stretching to the full terminal (normal flexbox).
  root.setStyle({ flexDirection: "column", padding: 1, gap: 1, alignItems: "start" }).setBg(base);

  root.appendChild(caption("Phase 02 · auto-size text — no <text> below sets width/height").setFg(accent));

  // A. Content-sized boxes (hug their label).
  root.appendChild(caption("A. boxes hug their text:"));
  const badges = row(2);
  badges.appendChild(badge("OK", green));
  badges.appendChild(badge("Cancel", pink));
  badges.appendChild(badge("✦ Save 你好 ✦", accent)); // wide chars measured too
  root.appendChild(badges);

  // B. wrap (default) vs nowrap on the same narrow width.
  root.appendChild(caption("B. wrap (default) vs nowrap — same width 20:"));
  const wrapRow = row(2);
  const sentence = "the quick brown fox jumps over the lazy dog";
  const wrapped = widthBox("wrap", 20, green);
  wrapped.textNode.setText(sentence).setFg(text); // default wrap → grows tall
  const clipped = widthBox("nowrap", 20, pink);
  clipped.textNode.setText(sentence).setFg(text).setTextWrap("nowrap"); // one clipped line
  wrapRow.appendChild(wrapped.box);
  wrapRow.appendChild(clipped.box);
  root.appendChild(wrapRow);

  // C. Auto height from wrapped + explicit \n content.
  root.appendChild(caption("C. auto height (wrap + \\n):"));
  const multi = widthBox("notes", 28, accent);
  multi.textNode
    .setText("first line\nthis second line is long enough to wrap onto more rows\nlast")
    .setFg(text);
  root.appendChild(multi.box);

  root.appendChild(caption(process.stdin.isTTY ? "press any key to exit…" : "").setFg(subtle));

  renderer.render();
  await waitForKey(HOLD_MS);
} finally {
  restore();
  renderer.free();
}
