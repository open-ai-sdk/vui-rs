<template>
  <!-- The app shell holds focus so global keys dispatch while "busy", but
       clickFocus:false means a click on the transcript never steals focus from the
       input — the composer keeps typing. A miniature of the 1sc composer. -->
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="theme.background"
    :fg="theme.text"
    :focusable="true"
    :clickFocus="false"
  >
    <text :fg="theme.primary" bold>vui-rs · anchored autocomplete popup</text>
    <text :fg="theme.textMuted">
      Type <b :fg="theme.success">/</b> or <b :fg="theme.success">@</b> — the menu opens UPWARD over the transcript with
      no layout shift. Click the transcript or scroll it; the input keeps focus.
    </text>
    <text> </text>

    <!-- Tall scrollable content. Non-focusable so a click resolves up to the
         clickFocus:false shell (→ no focus move); wheel-scroll still works. -->
    <scroll-box
      :flexGrow="1"
      :focusable="false"
      border="rounded"
      :borderColor="theme.border"
      :padding="{ left: 1, right: 1 }"
    >
      <text v-for="line in lines" :key="line.id" :fg="line.fg">{{ line.text }}</text>
    </scroll-box>

    <text> </text>

    <!-- The input owns focus; its wrapper forwards Up/Down to the autocomplete and
         is the anchor the popup measures itself against (useElementRect). -->
    <box ref="anchorRef" flexDirection="column" @keyDown="ac.onKeyDown">
      <box border="rounded" :borderColor="theme.border" :padding="{ left: 1, right: 1 }">
        <VuiInput
          :value="query"
          placeholder="Type / or @ …"
          :focused="true"
          :cursorColor="theme.primary"
          tabBehavior="capture"
          @update:value="(v: string) => (query = v)"
          @enter="onEnter"
        />
      </box>
    </box>

    <VuiAutocomplete
      :suggestions="ac.suggestions.value"
      :active="ac.active.value"
      :anchor="anchor"
      :emptyText="emptyText"
      @select="(s: Suggestion) => accept(s)"
    />

    <text :fg="theme.textMuted"
      >Accepted: <b :fg="theme.info">{{ accepted.join(', ') || '—' }}</b> · Ctrl-C quits</text
    >
  </box>
</template>

<script setup lang="ts">
import { computed, ref, useElementRect, useTheme, VuiInput } from '@vui-rs/vue'
import { VuiAutocomplete, useAutocomplete, type Suggestion } from '@vui-rs/ui'

const theme = useTheme()
const query = ref('')
const accepted = ref<string[]>([])

// Show a "no results" placeholder only while a trigger is being typed — so an empty
// or plain query renders nothing, but `/zzz` keeps the popup open with the hint.
const emptyText = computed(() => (/^[/@]/.test(query.value) ? 'No matching items' : undefined))

// The popup anchors to the input wrapper's screen rect (reactive, updates on
// resize / content growth). Drives the upward overlay placement.
const anchorRef = ref()
const anchor = useElementRect(anchorRef)

const PEOPLE = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy']
const COMMANDS = ['help', 'clear', 'reset', 'reload', 'quit', 'model', 'theme', 'session', 'compact', 'undo']

const ac = useAutocomplete({
  query: () => query.value,
  providers: [
    (q) =>
      q.startsWith('@')
        ? PEOPLE.filter((p) => p.startsWith(q.slice(1))).map((p) => ({ label: '@' + p, value: p, hint: 'user' }))
        : [],
    (q) =>
      q.startsWith('/')
        ? COMMANDS.filter((c) => c.startsWith(q.slice(1))).map((c) => ({ label: '/' + c, value: c, hint: 'cmd' }))
        : [],
  ],
  onAccept: accept,
  onComplete: accept,
})

function accept(s: Suggestion): void {
  accepted.value.push(s.value)
  query.value = ''
}

// The input consumes Enter (it never reaches ac.onKeyDown), so accept here.
function onEnter(): void {
  if (ac.visible.value) ac.accept()
}

interface Line {
  id: number
  text: string
  /** Theme tokens are packed color numbers; a hex string also works. */
  fg: string | number
}
// Tall content so the popup visibly overlays a scrollable transcript.
const lines = ref<Line[]>(
  Array.from({ length: 40 }, (_, i) => {
    const role = i % 3 === 0 ? 'you' : 'agent'
    return {
      id: i,
      text: `${String(i + 1).padStart(3, ' ')} · ${role}: transcript line of content here`,
      fg: role === 'you' ? theme.success : theme.text,
    }
  }),
)
</script>
