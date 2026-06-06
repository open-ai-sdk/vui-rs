<template>
  <box :width="{ pct: 1 }" :height="{ pct: 1 }" flexDirection="column"
       :padding="{ left: 2, right: 2, top: 1, bottom: 1 }" :bg="theme.background" :fg="theme.text"
       :focusable="true" :focused="true" @keyDown="onKey">
    <text :fg="theme.primary" bold>vui-rs · toasts</text>
    <text :fg="theme.textMuted">Non-blocking corner notifications; auto-dismiss + fade on the animation engine.</text>
    <text> </text>
    <text>Press
      <b :fg="theme.info">i</b> info ·
      <b :fg="theme.success">s</b> success ·
      <b :fg="theme.warning">w</b> warning ·
      <b :fg="theme.error">e</b> error
    </text>
    <text><b :fg="theme.success">x</b> clear all · <b :fg="theme.success">p</b> sticky (no auto-dismiss)</text>
    <text> </text>
    <text :fg="theme.textMuted">Active toasts: {{ toast.toasts.length }}</text>
    <text> </text>
    <text :fg="theme.textMuted"><b :fg="theme.error">q</b> / Ctrl-C to quit</text>

    <VuiToastHost position="top-right" />
  </box>
</template>

<script setup lang="ts">
import { useTheme } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";
import { provideToasts, VuiToastHost } from "@vui-rs/ui";

const theme = useTheme();
const toast = provideToasts();
let n = 0;

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== "key") return;
  ev.preventDefault();
  switch (ev.name) {
    case "i": toast.show(`Info message #${++n}`, { kind: "info" }); break;
    case "s": toast.show(`Saved successfully #${++n}`, { kind: "success" }); break;
    case "w": toast.show(`Warning: check your input #${++n}`, { kind: "warning" }); break;
    case "e": toast.show(`Error: something failed #${++n}`, { kind: "error" }); break;
    case "p": toast.show(`Sticky toast #${++n} — dismiss me`, { kind: "info", duration: 0 }); break;
    case "x": toast.clear(); break;
    case "q": process.exit(0);
  }
}
</script>
