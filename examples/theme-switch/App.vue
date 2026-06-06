<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="theme.background"
    :fg="theme.text"
  >
    <text :fg="theme.primary" bold>vui-rs · runtime theme switch demo</text>
    <text :fg="theme.textMuted">
      <b :fg="theme.success">t</b> next theme ·
      <b :fg="theme.success">T</b> prev theme ·
      <b :fg="theme.success">m</b> toggle dark/light ·
      <b :fg="theme.error">Esc</b> quit
    </text>
    <text>
      <span :fg="theme.textMuted">theme </span>
      <b :fg="theme.accent">{{ names[index] }}</b>
      <span :fg="theme.textMuted"> · mode </span>
      <b :fg="theme.accent">{{ mode }}</b>
    </text>
    <text> </text>

    <scroll-box
      :height="20"
      :scrollbar="true"
      :focused="true"
      border="rounded"
      :padding="{ left: 1, right: 1 }"
      @keyDown="onKey"
    >
      <markdown :content="MD" />
      <text> </text>
      <diff :patch="PATCH" :lineNumbers="true" />
    </scroll-box>
  </box>
</template>

<script setup lang="ts">
import { ref, useTheme, useSetTheme, listThemes } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";

// `useTheme()` returns the reactive app theme: reading tokens in this template
// re-renders the whole demo when `setTheme` swaps the active theme — no remount.
const theme = useTheme();
const setTheme = useSetTheme();

const names = listThemes();
const index = ref(0);
const mode = ref<"dark" | "light">("dark");

function apply(): void {
  setTheme(names[index.value]!, mode.value);
}

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  if (ev.name === "t" && !ev.shift) {
    ev.preventDefault();
    index.value = (index.value + 1) % names.length;
    apply();
  } else if (ev.name === "t" && ev.shift) {
    ev.preventDefault();
    index.value = (index.value - 1 + names.length) % names.length;
    apply();
  } else if (ev.name === "m") {
    ev.preventDefault();
    mode.value = mode.value === "dark" ? "light" : "dark";
    apply();
  } else if (ev.name === "escape") {
    ev.preventDefault();
    process.exit(0);
  }
}

const MD = `# Theme system

A **runtime** theme switch over *semantic tokens*.

- markdown heading, links, and \`inline code\`
- syntax-highlighted fences recolor with the theme

\`\`\`ts
function greet(name: string): number {
  const n = name.length; // comment
  return n * 2;
}
\`\`\`
`;

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
@@ -1,4 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  // friendlier
+  return \`hi, \${name}!\`;
 }
`;
</script>
