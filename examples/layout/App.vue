<!-- Flexbox layout: a horizontal row of two grow:1 panels + a fixed-width
     sidebar, all positioned by taffy. Shows flex split, borders + titles, rich
     multi-run wrapped text, and wide characters. -->
<template>
  <box flexDirection="row" :width="{ pct: 1 }" :height="{ pct: 1 }" :padding="1" :gap="2" :bg="BASE">
    <box
      :flexGrow="1"
      :flexBasis="0"
      :minWidth="0"
      :height="{ pct: 1 }"
      border="single"
      :borderColor="ACCENT"
      :bg="SURFACE"
      :padding="1"
      title=" left · flex-grow:1 "
      titleAlign="center"
    >
      <text :width="{ pct: 1 }" :height="{ pct: 1 }" :fg="TEXT"
        >Rich <b :fg="GREEN">bold</b> + <i :fg="PINK">italic</i> runs, wrapping across the content box as the panel is
        sized by taffy. <span :fg="ACCENT">Wide: 你好 世界 🦀</span></text
      >
    </box>

    <box
      :flexGrow="1"
      :flexBasis="0"
      :minWidth="0"
      :height="{ pct: 1 }"
      border="rounded"
      :borderColor="GREEN"
      :bg="SURFACE"
      :padding="1"
      title=" right "
      titleAlign="left"
    >
      <text :width="{ pct: 1 }" :height="{ pct: 1 }" :fg="TEXT"
        >A second flex child. Both panels split the row evenly. Ctrl-C to exit.</text
      >
    </box>

    <box :width="16" :height="{ pct: 1 }" border="double" :borderColor="SUBTLE" :bg="BASE" :padding="1">
      <text :width="{ pct: 1 }" :height="{ pct: 1 }" :fg="SUBTLE">{{ SIDE }}</text>
    </box>
  </box>
</template>

<script setup lang="ts">
const BASE = '#1e1e2e'
const SURFACE = '#313244'
const ACCENT = '#89b4fa'
const GREEN = '#a6e3a1'
const PINK = '#f5c2e7'
const TEXT = '#cdd6f4'
const SUBTLE = '#7f849c'

const SIDE = 'width:16\nfixed\nsidebar'
</script>
