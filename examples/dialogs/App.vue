<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="theme.background"
    :fg="theme.text"
    :focusable="true"
    :focused="!anyOpen"
    @keyDown="onKey"
  >
    <text :fg="theme.primary" bold>vui-rs · dialog family</text>
    <text :fg="theme.textMuted">A base modal (overlay + dim backdrop + focus-trap + Esc) and its variants.</text>
    <text> </text>
    <text
      >Press <b :fg="theme.success">c</b> confirm · <b :fg="theme.success">a</b> alert ·
      <b :fg="theme.success">p</b> prompt · <b :fg="theme.success">s</b> fuzzy select
    </text>
    <text> </text>
    <text :fg="theme.textMuted">Last result:</text>
    <text :fg="theme.info">{{ result || '—' }}</text>
    <text> </text>
    <text :fg="theme.textMuted"><b :fg="theme.error">q</b> / Ctrl-C to quit</text>

    <VuiDialogConfirm
      v-model:open="confirmOpen"
      title="Confirm"
      message="Ship this build to production?"
      @confirm="(v: boolean) => (result = v ? 'Confirmed: shipped 🚀' : 'Cancelled')"
    />
    <VuiDialogAlert
      v-model:open="alertOpen"
      title="Heads up"
      message="This is an alert. Enter / Space / Esc to dismiss."
      @close="result = 'Alert dismissed'"
    />
    <VuiDialogPrompt
      v-model:open="promptOpen"
      title="Rename file"
      message="New file name:"
      placeholder="file.ts"
      :validate="validateName"
      @submit="(v: string) => (result = 'Renamed to ' + v)"
    />
    <VuiDialogSelect
      v-model:open="selectOpen"
      title="Open file"
      :items="files"
      @select="(v: string) => (result = 'Opened ' + v)"
    />
  </box>
</template>

<script setup lang="ts">
import { computed, ref, useTheme } from '@vui-rs/vue'
import type { DispatchableEvent } from '@vui-rs/vue'
import { VuiDialogConfirm, VuiDialogAlert, VuiDialogPrompt, VuiDialogSelect } from '@vui-rs/ui'

const theme = useTheme()
const result = ref('')
const confirmOpen = ref(false)
const alertOpen = ref(false)
const promptOpen = ref(false)
const selectOpen = ref(false)
const anyOpen = computed(() => confirmOpen.value || alertOpen.value || promptOpen.value || selectOpen.value)

const files = [
  { label: 'src/index.ts', value: 'src/index.ts', group: 'Source', hint: 'ts' },
  { label: 'src/app.ts', value: 'src/app.ts', group: 'Source', hint: 'ts' },
  { label: 'src/theme.ts', value: 'src/theme.ts', group: 'Source', hint: 'ts' },
  { label: 'README.md', value: 'README.md', group: 'Docs', hint: 'md' },
  { label: 'package.json', value: 'package.json', group: 'Config', hint: 'json' },
]

function validateName(v: string): string | null {
  if (v.trim().length === 0) return 'Name cannot be empty'
  if (!/\.[a-z]+$/.test(v)) return 'Include a file extension'
  return null
}

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== 'key') return
  const map: Record<string, () => void> = {
    c: () => (confirmOpen.value = true),
    a: () => (alertOpen.value = true),
    p: () => (promptOpen.value = true),
    s: () => (selectOpen.value = true),
    q: () => process.exit(0),
  }
  const action = map[ev.name]
  if (action) {
    ev.preventDefault()
    action()
  }
}
</script>
