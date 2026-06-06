<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="theme.background"
    :fg="theme.text"
    :focusable="true"
    :focused="!open"
    @keyDown="onKey"
  >
    <text :fg="theme.primary" bold>vui-rs · command palette</text>
    <text :fg="theme.textMuted">Ctrl-K opens the palette; type to fuzzy-search, Enter to run, Esc to close.</text>
    <text> </text>
    <text>Press <b :fg="theme.success">Ctrl-K</b> (or <b :fg="theme.success">k</b>) to open.</text>
    <text> </text>
    <text :fg="theme.textMuted">Log:</text>
    <box flexDirection="column">
      <text v-for="(line, i) in log.slice(-6)" :key="i" :fg="theme.info">{{ line }}</text>
    </box>
    <text> </text>
    <text :fg="theme.textMuted"><b :fg="theme.error">q</b> / Ctrl-C to quit</text>

    <VuiCommandPalette v-model:open="open" :commands="commands" />
  </box>
</template>

<script setup lang="ts">
import { ref, useTheme } from '@vui-rs/vue'
import type { DispatchableEvent } from '@vui-rs/vue'
import { VuiCommandPalette, type Command } from '@vui-rs/ui'

const theme = useTheme()
const open = ref(false)
const log = ref<string[]>([])
const note = (s: string) => log.value.push(s)

const commands: Command[] = [
  { id: 'build', title: 'Build project', hint: '⌘B', group: 'Tasks', run: () => note('→ build') },
  { id: 'test', title: 'Run tests', hint: '⌘T', group: 'Tasks', run: () => note('→ test') },
  { id: 'lint', title: 'Lint & format', hint: '⌘L', group: 'Tasks', run: () => note('→ lint') },
  { id: 'open', title: 'Open file…', hint: '⌘P', group: 'Navigate', run: () => note('→ open file') },
  { id: 'goto', title: 'Go to symbol', hint: '⌘⇧O', group: 'Navigate', run: () => note('→ goto symbol') },
  { id: 'theme', title: 'Toggle theme', hint: '⌘K T', group: 'View', run: () => note('→ theme') },
  { id: 'quit', title: 'Quit', hint: '⌃C', group: 'App', run: () => process.exit(0) },
]

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== 'key') return
  if ((ev.ctrl && ev.name === 'k') || ev.name === 'k') {
    ev.preventDefault()
    open.value = true
  } else if (ev.name === 'q') {
    process.exit(0)
  }
}
</script>
