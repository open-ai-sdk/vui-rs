<!-- SFC port of examples/counter.ts: a ref ticking once a second, repainting a
     bordered box. Demonstrates reactive state + interpolation + an inline <b>. -->
<template>
  <box
    :width="34"
    :height="5"
    flexDirection="column"
    justifyContent="center"
    :padding="{ left: 2, right: 2, top: 0, bottom: 0 }"
    :bg="BASE"
    border="rounded"
    :borderColor="BLUE"
    title=" vui counter "
    titleAlign="center"
  >
    <text :width="{ pct: 1 }" :height="1" :fg="TEXT">count: <b :fg="GREEN">{{ count }}</b></text>
    <text :width="{ pct: 1 }" :height="1" :fg="SUBTLE">a ref ticking once a second</text>
  </box>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "@vui-rs/vue";

const BASE = "#1e1e2e";
const TEXT = "#cdd6f4";
const GREEN = "#a6e3a1";
const BLUE = "#89b4fa";
const SUBTLE = "#7f849c";

const count = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => count.value++, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>
