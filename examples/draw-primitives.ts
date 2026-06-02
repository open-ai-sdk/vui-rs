#!/usr/bin/env bun
// Phase 01 smoke test: drive the native renderer directly (no Vue, no layout).
// Draws a bordered panel with styled, colored, and wide-character text, renders
// one frame, waits for a keypress, then restores the terminal.
//
// Terminal setup/teardown lives here in TS (the renderer only emits the frame
// diff): we enter the alternate screen and hide the cursor up front, and a
// guaranteed teardown path restores them on normal exit, Ctrl-C, or a crash.
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

function drawBorder(r: Renderer, x: number, y: number, w: number, h: number, fg: number): void {
  const style = { fg };
  r.drawText(x, y, "┌" + "─".repeat(w - 2) + "┐", style);
  r.drawText(x, y + h - 1, "└" + "─".repeat(w - 2) + "┘", style);
  for (let row = y + 1; row < y + h - 1; row++) {
    r.drawText(x, row, "│", style);
    r.drawText(x + w - 1, row, "│", style);
  }
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

// Teardown hooks before we touch the terminal.
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

const renderer = new Renderer(width, height);
try {
  enterAltScreen();

  const panelBg = rgba(24, 24, 37);
  const accent = rgba(137, 180, 250);
  const text = rgba(205, 214, 244);

  renderer.clear(rgba(17, 17, 27));
  renderer.fillRect(2, 1, 44, 12, panelBg);
  drawBorder(renderer, 2, 1, 44, 12, accent);

  renderer.drawText(4, 2, " vui-rs · native renderer ", { fg: rgba(17, 17, 27), bg: accent, attrs: Attr.BOLD });
  renderer.drawText(4, 4, "Truecolor + diff rendering from Rust.", { fg: text, bg: panelBg });
  renderer.drawText(4, 6, "bold", { fg: text, bg: panelBg, attrs: Attr.BOLD });
  renderer.drawText(9, 6, "italic", { fg: text, bg: panelBg, attrs: Attr.ITALIC });
  renderer.drawText(16, 6, "underline", { fg: text, bg: panelBg, attrs: Attr.UNDERLINE });
  renderer.drawText(26, 6, "inverse", { fg: text, bg: panelBg, attrs: Attr.INVERSE });
  renderer.drawText(4, 8, "colors:", { fg: text, bg: panelBg });
  renderer.drawText(12, 8, "■", { fg: rgba(243, 139, 168), bg: panelBg });
  renderer.drawText(14, 8, "■", { fg: rgba(166, 227, 161), bg: panelBg });
  renderer.drawText(16, 8, "■", { fg: rgba(249, 226, 175), bg: panelBg });
  renderer.drawText(18, 8, "■", { fg: rgba(137, 220, 235), bg: panelBg });
  renderer.drawText(4, 10, "wide chars: 你好 · 世界 · 🦀", { fg: text, bg: panelBg });
  renderer.drawText(4, 11, "press any key to exit…", { fg: rgba(127, 132, 156), bg: panelBg, attrs: Attr.DIM });

  renderer.render();
  await waitForKey(15_000);
} finally {
  restore();
  renderer.free();
}
