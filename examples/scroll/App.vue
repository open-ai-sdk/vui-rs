<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="BASE"
    :fg="TEXT"
  >
    <text :fg="BLUE" bold>vui-rs · scroll + stick-to-bottom demo</text>
    <text :fg="SUBTLE">
      <b :fg="GREEN">a</b> add line · <b :fg="GREEN">↑/↓ PgUp/PgDn</b> scroll ·
      <b :fg="GREEN">Home</b> top · <b :fg="GREEN">End</b> bottom · <b :fg="RED">Esc</b> quit
    </text>
    <text> </text>

    <!-- The transcript: a fixed-height viewport that clips + culls its rows,
         shows an integrated scrollbar, and stays pinned to the newest line until
         the user scrolls up. -->
    <scroll-box
      :height="10"
      :stickToBottom="true"
      :scrollbar="true"
      :focused="true"
      border="rounded"
      :borderColor="BORDER"
      :padding="{ left: 1, right: 1 }"
      @keyDown="onKey"
    >
      <text v-for="line in lines" :key="line.id" :fg="line.fg">
        {{ line.text }}
      </text>
    </scroll-box>

    <text :fg="SUBTLE">{{ lines.length }} lines · 5000-row stress: bun run examples/paint-bench.ts</text>
  </box>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";

const BASE = "#111827";
const TEXT = "#e5e7eb";
const BLUE = "#60a5fa";
const GREEN = "#34d399";
const RED = "#f87171";
const SUBTLE = "#9ca3af";
const BORDER = "#374151";

interface Line {
  id: number;
  text: string;
  fg: string;
}

let next = 0;
function makeLine(): Line {
  next += 1;
  const role = next % 3 === 0 ? "you" : "agent";
  return {
    id: next,
    text: `${String(next).padStart(3, " ")} · ${role}: line of transcript content here`,
    fg: role === "you" ? GREEN : TEXT,
  };
}

// Seed enough rows to overflow the 10-row viewport so scrolling is visible.
const lines = ref<Line[]>(Array.from({ length: 24 }, makeLine));

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "a") {
    ev.preventDefault();
    lines.value = [...lines.value, makeLine()];
  } else if (ev.name === "escape") {
    ev.preventDefault();
    process.exit(0);
  }
}
</script>
