<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="BASE"
    :fg="TEXT"
  >
    <text :fg="BLUE" bold>vui-rs · unified diff viewer demo</text>
    <text :fg="SUBTLE">
      <b :fg="GREEN">n</b> toggle line numbers ·
      <b :fg="GREEN">↑/↓ PgUp/PgDn</b> scroll · <b :fg="RED">Esc</b> quit
    </text>
    <text> </text>

    <scroll-box
      :height="18"
      :scrollbar="true"
      :focused="true"
      border="rounded"
      :borderColor="BORDER"
      :padding="{ left: 1, right: 1 }"
      @keyDown="onKey"
    >
      <diff :patch="PATCH" :lineNumbers="numbers" />
    </scroll-box>

    <text :fg="SUBTLE">line numbers: {{ numbers ? "on" : "off" }}</text>
  </box>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";

const BASE = "#1e1e2e";
const TEXT = "#cdd6f4";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const RED = "#f38ba8";
const SUBTLE = "#7f849c";
const BORDER = "#585b70";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,6 +1,7 @@
 export function greet(name: string): string {
-  return "hello " + name;
+  // friendlier, templated greeting
+  return \`hello, \${name}!\`;
 }

-const msg = greet("world");
+const msg = greet("vui-rs");
 console.log(msg);
`;

const numbers = ref(true);

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "n") {
    ev.preventDefault();
    numbers.value = !numbers.value;
  } else if (ev.name === "escape") {
    ev.preventDefault();
    process.exit(0);
  }
}
</script>
