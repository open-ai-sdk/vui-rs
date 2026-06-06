<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="theme.background"
    :fg="theme.text"
  >
    <text :fg="theme.primary" bold>vui-rs · virtual list</text>
    <text :fg="theme.textMuted">
      {{ COUNT.toLocaleString() }} rows, but only the visible window is mounted (O(visible)).
    </text>
    <text :fg="theme.textMuted">↑/↓ · PageUp/PageDown · Home/End · mouse wheel · Ctrl-C to quit</text>
    <text> </text>

    <box flexDirection="column" border="rounded" :borderColor="theme.border" :padding="{ left: 1, right: 1 }">
      <!-- Explicit height (rows) computed from the terminal size fills the screen. -->
      <VuiVirtualList
        :items="rows"
        :height="listHeight"
        :scrollbar="true"
        :focused="true"
        @scroll="(y: number) => (top = y)"
      >
        <template #default="{ item, index }">
          <box flexDirection="row" justifyContent="space-between">
            <text :fg="index % 2 ? theme.text : theme.textMuted">{{ item }}</text>
            <text :fg="theme.textMuted">#{{ index }}</text>
          </box>
        </template>
      </VuiVirtualList>
    </box>

    <text :fg="theme.textMuted"
      >top row: <b :fg="theme.info">{{ top }}</b></text
    >
  </box>
</template>

<script setup lang="ts">
import { ref, useTheme } from '@vui-rs/vue'
import { VuiVirtualList } from '@vui-rs/ui'

const theme = useTheme()
const COUNT = 100_000
const top = ref(0)
const rows = Array.from({ length: COUNT }, (_, i) => `Virtualized row — lorem ipsum dolor sit amet · item ${i}`)
// Fill the screen: terminal rows minus this view's chrome (title/hints/border/footer).
const listHeight = Math.max(3, (process.stdout.rows ?? 24) - 9)
</script>
