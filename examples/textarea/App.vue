<template>
  <box :width="{ pct: 1 }" :height="{ pct: 1 }" flexDirection="column" :padding="1" :bg="BASE">
    <text :height="1" :fg="SUBTLE">Textarea only · Tab inserts spaces · Ctrl-Z undo · Ctrl-C quit</text>
    <textarea
      :width="{ pct: 1 }"
      :height="{ pct: 1 }"
      border="rounded"
      :borderColor="BLUE"
      :bg="SURFACE"
      :fg="TEXT"
      :cursorColor="GREEN"
      placeholder="Type here. Tab indents inside this editor."
      :placeholderColor="SUBTLE"
      wrap="word"
      tabBehavior="indent"
      :tabSize="2"
      focused
      v-model="body"
    />
  </box>
</template>

<script setup lang="ts">
import { ref } from '@vui-rs/vue'

const BASE = '#1e1e2e'
const SURFACE = '#313244'
const TEXT = '#cdd6f4'
const BLUE = '#89b4fa'
const GREEN = '#a6e3a1'
const SUBTLE = '#7f849c'

const body = ref('')
</script>
