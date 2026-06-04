<template>
  <box
    :width="42"
    :height="13"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    border="rounded"
    :borderColor="BLUE"
    :bg="BASE"
    :fg="TEXT"
    title=" select "
  >
    <text :fg="SUBTLE">Choose a runtime</text>
    <box flexDirection="row" :height="6" :width="{ pct: 1 }">
      <scroll-box
        v-model="scrollY"
        :width="34"
        :height="6"
        :bg="SURFACE"
        :focusable="false"
      >
        <select-list
          :items="items"
          v-model="selected"
          :activeBg="BLUE"
          :activeFg="BASE"
          :selectedFg="GREEN"
          :focused="true"
          @active="keepActiveVisible"
        />
      </scroll-box>
      <scroll-bar
        v-model:scrollY="scrollY"
        :viewportHeight="6"
        :contentHeight="items.length"
        :thumbBg="GREEN"
        :trackBg="SURFACE"
      />
    </box>
    <text :fg="TEXT">Selected: <b :fg="GREEN">{{ selected }}</b></text>
    <text :fg="SUBTLE">Arrows, wheel, Enter, or click</text>
  </box>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";

const BASE = "#111827";
const SURFACE = "#1f2937";
const TEXT = "#e5e7eb";
const BLUE = "#60a5fa";
const GREEN = "#34d399";
const SUBTLE = "#9ca3af";

const items = [
  "bun",
  "node",
  "deno",
  "wasmtime",
  "quickjs",
  "spidermonkey",
  "javascriptcore",
  "v8",
];
const selected = ref("bun");
const scrollY = ref(0);

function keepActiveVisible(index: number): void {
  const viewportHeight = 6;
  if (index < scrollY.value) scrollY.value = index;
  else if (index >= scrollY.value + viewportHeight) {
    scrollY.value = index - viewportHeight + 1;
  }
}
</script>
