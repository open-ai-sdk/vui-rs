<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="BASE"
    :fg="TEXT"
  >
    <text :fg="BLUE" bold>vui-rs · markdown + code highlight demo</text>
    <text :fg="SUBTLE">
      <b :fg="GREEN">s</b> stream the answer · <b :fg="GREEN">r</b> reset ·
      <b :fg="GREEN">↑/↓ PgUp/PgDn</b> scroll · <b :fg="RED">Esc</b> quit
    </text>
    <text> </text>

    <scroll-box
      :height="18"
      :stickToBottom="true"
      :scrollbar="true"
      :focused="true"
      border="rounded"
      :borderColor="BORDER"
      :padding="{ left: 1, right: 1 }"
      @keyDown="onKey"
    >
      <markdown :content="shown" />
    </scroll-box>

    <text :fg="SUBTLE">{{ shown.length }} / {{ SOURCE.length }} chars rendered</text>
  </box>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";

const BASE = "#1e1e2e";
const TEXT = "#cdd6f4";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const RED = "#f38ba8";
const SUBTLE = "#7f849c";
const BORDER = "#585b70";

const SOURCE = `# Project status

A quick **markdown** answer with _emphasis_, inline \`code\`, and a [link](https://example.com).

## Highlights
- Streaming-friendly render
- Syntax highlight via a swappable highlighter
- Unified diff viewer (see the diff example)

> Note: highlight.js is the default; tree-sitter can be plugged in later.

\`\`\`ts
function greet(name: string): string {
  // build the greeting
  return \`hello, \${name}!\`;
}
\`\`\`

\`\`\`python
def add(a, b):
    return a + b  # sum
\`\`\`

| Lang | Status |
|------|--------|
| ts   | ok     |
| rust | ok     |
`;

const cursor = ref(SOURCE.length);
const shown = computed(() => SOURCE.slice(0, cursor.value));
let timer: ReturnType<typeof setInterval> | undefined;

function stopStream(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

function stream(): void {
  stopStream();
  cursor.value = 0;
  timer = setInterval(() => {
    // Advance a few chars per tick to mimic token streaming.
    cursor.value = Math.min(SOURCE.length, cursor.value + 6);
    if (cursor.value >= SOURCE.length) stopStream();
  }, 24);
}

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "s") {
    ev.preventDefault();
    stream();
  } else if (ev.name === "r") {
    ev.preventDefault();
    stopStream();
    cursor.value = SOURCE.length;
  } else if (ev.name === "escape") {
    ev.preventDefault();
    process.exit(0);
  }
}

onUnmounted(stopStream);
</script>
