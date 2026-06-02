<!-- SFC port of examples/form.ts: two native inputs with v-model, Tab to move
     focus. Demonstrates the v-model contract (`<input v-model>` → VuiInput),
     v-for over a field config, and a v-if greeting. (The .ts version exits the
     process on Enter; this UI-only demo just reflects the typed values.) -->
<template>
  <box
    :width="48"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="BASE"
    border="rounded"
    :borderColor="BLUE"
    title=" sign up "
    titleAlign="center"
  >
    <template v-for="(field, i) in fields" :key="field.key">
      <text :width="{ pct: 1 }" :height="1" :fg="SUBTLE">{{ field.label }}</text>
      <input
        :width="{ pct: 1 }"
        :height="3"
        border="rounded"
        :borderColor="BLUE"
        :bg="SURFACE"
        :fg="TEXT"
        :cursorColor="GREEN"
        :placeholder="field.placeholder"
        :placeholderColor="SUBTLE"
        :focused="i === 0"
        v-model="values[field.key]"
      />
    </template>
    <text v-if="values.name" :width="{ pct: 1 }" :height="1" :fg="TEXT">
      Hi <b :fg="GREEN">{{ values.name }}</b>!
    </text>
    <text :width="{ pct: 1 }" :height="1" :fg="SUBTLE">Tab to switch · Ctrl-C to quit</text>
  </box>
</template>

<script setup lang="ts">
import { reactive } from "@vui-rs/vue";

const BASE = "#1e1e2e";
const SURFACE = "#313244";
const TEXT = "#cdd6f4";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const SUBTLE = "#7f849c";

const fields = [
  { key: "name", label: "Name", placeholder: "your name" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
] as const;

const values = reactive<Record<string, string>>({ name: "", email: "" });
</script>
