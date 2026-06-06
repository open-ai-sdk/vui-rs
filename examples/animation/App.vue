<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="BASE"
    :fg="TEXT"
    :focusable="true"
    :focused="!open"
    @keyDown="onKey"
  >
    <text :fg="BLUE" bold>vui-rs · animation + timeline demo</text>
    <text :fg="SUBTLE">
      <b :fg="GREEN">p</b> run progress · <b :fg="GREEN">m</b> open modal (slide + dim) · <b :fg="RED">Esc</b> quit
    </text>
    <text> </text>

    <!-- Spinner presets — each runs on the shared frame loop, no private timer. -->
    <box flexDirection="row" :gap="3" :padding="{ bottom: 1 }">
      <VuiSpinner preset="braille" :color="GREEN" label="braille" />
      <VuiSpinner preset="dots" :color="BLUE" label="dots" :interval="90" />
      <VuiSpinner preset="line" :color="MAUVE" label="line" :interval="100" />
    </box>

    <!-- Eased progress bar (animated 0 → 100% on `p`). -->
    <text :fg="SUBTLE">progress · easeOutCubic</text>
    <box flexDirection="row" :gap="1">
      <text :fg="GREEN" :width="BAR + 2" :height="1">{{ bar }}</text>
      <text :fg="TEXT">{{ Math.round(progress * 100) }}%</text>
    </box>
  </box>

  <!-- Slide-in modal: a spacer above the dialog shrinks (easeOutCubic) so the
       dialog slides down, while the backdrop darkens from clear to dim. -->
  <overlay v-if="open" :backdrop="backdrop" flexDirection="column" alignItems="center">
    <box :height="slide" />
    <box
      :width="40"
      :height="6"
      flexDirection="column"
      :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
      border="rounded"
      :borderColor="BLUE"
      :bg="SURFACE"
      :fg="TEXT"
      title=" Animated dialog "
      :focusable="true"
      :focused="open"
      @keyDown="onModalKey"
    >
      <text :fg="TEXT">Slid in on the timeline engine.</text>
      <text> </text>
      <text :fg="SUBTLE"><b :fg="RED">Esc</b> to close</text>
    </box>
  </overlay>
</template>

<script setup lang="ts">
import { VuiSpinner, computed, ref, useTimeline } from '@vui-rs/vue'
import type { DispatchableEvent } from '@vui-rs/vue'

const BASE = '#1e1e2e'
const SURFACE = '#313244'
const TEXT = '#cdd6f4'
const BLUE = '#89b4fa'
const GREEN = '#a6e3a1'
const MAUVE = '#cba6f7'
const RED = '#f38ba8'
const SUBTLE = '#7f849c'

const BAR = 24

const timeline = useTimeline()
const progress = ref(0)
const bar = computed(() => {
  const filled = Math.round(progress.value * BAR)
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
})

const open = ref(false)
const backdrop = ref(0)
const slide = ref(0)

function runProgress(): void {
  timeline.animate({
    from: 0,
    to: 1,
    duration: 1200,
    easing: 'outCubic',
    onUpdate: (v) => {
      progress.value = v
    },
  })
}

function openModal(): void {
  open.value = true
  timeline.animate({
    from: 0,
    to: 0.45,
    duration: 220,
    easing: 'outQuad',
    onUpdate: (v) => {
      backdrop.value = v
    },
  })
  timeline.animate({
    from: 6,
    to: 1,
    duration: 260,
    easing: 'outCubic',
    onUpdate: (v) => {
      slide.value = Math.round(v)
    },
  })
}

function onKey(ev: DispatchableEvent): void {
  if (ev.type !== 'key') return
  if (ev.name === 'p') {
    ev.preventDefault()
    runProgress()
  } else if (ev.name === 'm') {
    ev.preventDefault()
    openModal()
  } else if (ev.name === 'escape') {
    ev.preventDefault()
    process.exit(0)
  }
}

function onModalKey(ev: DispatchableEvent): void {
  if (ev.type !== 'key') return
  if (ev.name === 'escape') {
    ev.preventDefault()
    open.value = false
  }
}
</script>
