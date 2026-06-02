#!/usr/bin/env bun
// Layout smoke test: build a render-node tree by hand (no Vue yet) and let the
// native core lay it out with flexbox + paint it. Demonstrates flex split,
// borders + titles, rich multi-run text, and wide characters — all positioned by
// taffy in Rust.
//
// Terminal setup/teardown lives here in TS, like the draw-primitives demo: enter
// the alt screen + hide the cursor up front, and restore on any exit path.
import { Attr, Renderer, rgba } from "@vui-rs/core";

const width = process.stdout.columns ?? 80;
const height = process.stdout.rows ?? 24;

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
process.on("SIGINT", () => {
  restore();
  process.exit(0);
});
process.on("SIGTERM", () => {
  restore();
  process.exit(0);
});
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
try {
  enterAltScreen();

  // root: a horizontal flex row with padding and a gap between children.
  const root = renderer.rootNode();
  root.setStyle({ flexDirection: "row", padding: 1, gap: 2 }).setBg(base);

  // Left panel: a bordered, titled box that grows to fill, with rich text inside.
  const left = renderer.createNode("box");
  left
    .setStyle({ flexGrow: 1, height: { pct: 1 }, border: 1, padding: 1 })
    .setBg(surface)
    .setBorder("single", accent)
    .setTitle(" left · flex-grow:1 ", "center");
  const leftText = renderer.createNode("text");
  leftText.setStyle({ width: { pct: 1 }, height: { pct: 1 } }).setTextRuns([
    { text: "Rich ", fg: text },
    { text: "bold", fg: green, attrs: Attr.BOLD },
    { text: " + ", fg: text },
    { text: "italic", fg: pink, attrs: Attr.ITALIC },
    { text: " runs, wrapping across the content box as the panel is sized by taffy. ", fg: text },
    { text: "Wide: 你好 世界 🦀", fg: accent },
  ]);
  left.appendChild(leftText);

  // Right panel: a rounded box, also grows; shows a plain single-run text.
  const right = renderer.createNode("box");
  right
    .setStyle({ flexGrow: 1, height: { pct: 1 }, border: 1, padding: 1 })
    .setBg(surface)
    .setBorder("rounded", green)
    .setTitle(" right ", "left");
  const rightText = renderer.createNode("text");
  rightText.setStyle({ width: { pct: 1 }, height: { pct: 1 } }).setText(
    "A second flex child. Both panels split the row evenly. Press any key to exit…",
  );
  right.appendChild(rightText);

  // Narrow fixed-width sidebar (explicit width, doesn't grow).
  const side = renderer.createNode("box");
  side.setStyle({ width: 16, height: { pct: 1 }, border: 1, padding: 1 }).setBg(base).setBorder("double", subtle);
  const sideText = renderer.createNode("text");
  sideText.setStyle({ width: { pct: 1 }, height: { pct: 1 } }).setTextRuns([
    { text: "width:16\n", fg: subtle },
    { text: "fixed\n", fg: subtle },
    { text: "sidebar", fg: subtle, attrs: Attr.DIM },
  ]);
  side.appendChild(sideText);

  root.appendChild(left);
  root.appendChild(right);
  root.appendChild(side);

  renderer.render();
  await waitForKey(15_000);
} finally {
  restore();
  renderer.free();
}
