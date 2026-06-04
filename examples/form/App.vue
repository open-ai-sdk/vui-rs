<!-- Inputs + native-backed textarea with v-model + Tab focus. Demonstrates the
     v-model contract for <input>/<textarea>, v-for over a field config, and a
     live preview. UI-only: it just reflects the typed values. -->
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
      <text :fg="SUBTLE">{{ field.label }}</text>
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
    <text :fg="SUBTLE">Notes</text>
    <textarea
      :width="{ pct: 1 }"
      :height="5"
      border="rounded"
      :borderColor="BLUE"
      :bg="SURFACE"
      :fg="TEXT"
      :cursorColor="GREEN"
      placeholder="multi-line notes; Enter, arrows, Ctrl-Z"
      :placeholderColor="SUBTLE"
      wrap="word"
      v-model="values.notes"
    />
    <text v-if="values.name" :fg="TEXT"
      >Hi <b :fg="GREEN">{{ values.name }}</b
      >!</text
    >
    <text v-if="values.notes" :fg="SUBTLE">Notes: {{ values.notes }}</text>
    <text :fg="SUBTLE"
      >Tab to switch · Enter inserts newline · Ctrl-Z undo · Ctrl-C quit</text
    >
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

const values = reactive<Record<string, string>>({
  name: "",
  email: "",
  notes: "",
});
</script>
