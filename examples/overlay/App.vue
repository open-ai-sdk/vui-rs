<template>
  <!-- Background content: a full-screen panel. Focused while the modal is closed
       so it receives the "o" key to open. -->
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="BASE"
    :fg="TEXT"
    :focusable="true"
    :focused="!open"
    @keyDown="onBackgroundKey"
  >
    <text :fg="BLUE" bold>vui-rs · overlay demo</text>
    <text :fg="SUBTLE">A modal renders on a top layer over a dimmed backdrop.</text>
    <text> </text>
    <text :fg="TEXT">Press <b :fg="GREEN">o</b> to open the dialog.</text>
    <box flexDirection="column" :gap="0" :padding="{ top: 1 }">
      <text v-for="n in 8" :key="n" :fg="SUBTLE">
        row {{ n }} — content behind the modal gets dimmed
      </text>
    </box>
  </box>

  <!-- The overlay layer: fills the terminal, dims everything behind, and centers
       the dialog. Captures keys/mouse while open. -->
  <overlay
    v-if="open"
    :backdrop="0.35"
    alignItems="center"
    justifyContent="center"
  >
    <box
      :width="38"
      :height="7"
      flexDirection="column"
      :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
      border="rounded"
      :borderColor="BLUE"
      :bg="SURFACE"
      :fg="TEXT"
      title=" Confirm "
      :focusable="true"
      :focused="open"
      @keyDown="onDialogKey"
    >
      <text :fg="TEXT">Ship it?</text>
      <text> </text>
      <text :fg="SUBTLE">
        <b :fg="GREEN">Enter</b> to confirm · <b :fg="RED">Esc</b> to cancel
      </text>
    </box>
  </overlay>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";

const BASE = "#111827";
const SURFACE = "#1f2937";
const TEXT = "#e5e7eb";
const BLUE = "#60a5fa";
const GREEN = "#34d399";
const RED = "#f87171";
const SUBTLE = "#9ca3af";

const open = ref(false);

function onBackgroundKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "o") {
    ev.preventDefault();
    open.value = true;
  }
}

function onDialogKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "escape" || ev.name === "enter") {
    ev.preventDefault();
    open.value = false;
  }
}
</script>
