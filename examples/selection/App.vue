<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="BG"
    :fg="TEXT"
    focusable
    :focused="true"
    @keyDown="onKey"
  >
    <text :fg="ACCENT" bold>vui-rs · text selection + clipboard (OSC 52) demo</text>
    <text :fg="MUTED">
      <b :fg="GREEN">drag</b> the mouse over the text to select ·
      <b :fg="GREEN">Ctrl/Cmd-C</b> copies to the system clipboard ·
      <b :fg="GREEN">click</b> elsewhere or <b :fg="RED">Esc</b> clears / quits
    </text>
    <text> </text>

    <box
      :width="{ pct: 1 }"
      :flexGrow="1"
      border="rounded"
      :borderColor="BLUE"
      title=" selectable transcript "
      :padding="{ left: 1, right: 1 }"
    >
      <markdown :content="MD" />
    </box>

    <text> </text>
    <text :fg="MUTED"
      >Selection is line-flow (like an editor) and works over static
      <b :fg="TEXT">&lt;text&gt;</b> / <b :fg="TEXT">&lt;markdown&gt;</b>. Copy
      reads the rendered glyphs (what you see is what you copy).</text
    >
  </box>
</template>

<script setup lang="ts">
import type { DispatchableEvent } from "@vui-rs/vue";

const BG = "#1e1e2e";
const TEXT = "#cdd6f4";
const MUTED = "#9399b2";
const ACCENT = "#cba6f7";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const RED = "#f38ba8";

const MD = `# Releasing the kraken

The agent finished its run and produced a **summary**. You can now select any of
this text with the mouse and copy it — the selection highlights in *inverse* and
\`Ctrl/Cmd-C\` writes it to your clipboard via OSC 52.

- it spans multiple wrapped lines (drag down to see line-flow selection)
- inline \`code\`, **bold**, and links like [the docs](https://example.com) are
  all selectable as plain text
- wide glyphs survive the highlight: 世界 こんにちは 🌍

> Selection over static content is read-only — your inputs and textareas keep
> their own native selection.
`;

function onKey(ev: DispatchableEvent): void {
  if (ev.type === "key" && ev.name === "escape") {
    ev.preventDefault();
    process.exit(0);
  }
}
</script>
