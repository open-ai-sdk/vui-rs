<!-- Reactive counter: a ref ticking once a second repaints a bordered box.
     <text> auto-sizes (taffy measures the runs), so no explicit width/height. -->
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
    <text :fg="TEXT">count: <b :fg="GREEN">{{ count }}</b></text>
    <text :fg="SUBTLE">a ref ticking once a second · Ctrl-C to quit</text>
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
