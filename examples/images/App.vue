<template>
  <box
    :width="{ pct: 1 }"
    :height="{ pct: 1 }"
    flexDirection="column"
    :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
    :bg="BG"
    :fg="TEXT"
    focusable
    :focused="true"
    @keyDown="onKey"
  >
    <text :fg="ACCENT" bold>vui-rs · inline &lt;image&gt; demo</text>
    <text :fg="MUTED">
      encoding <b :fg="GREEN">{{ encoding }}</b> · half-block works everywhere · set
      <b :fg="GREEN">VUI_IMG_ENC=kitty</b> on a Kitty/Ghostty terminal for native graphics · <b :fg="RED">Esc</b> quit
    </text>
    <text> </text>

    <box flexDirection="row">
      <box
        :width="32"
        :height="16"
        border="rounded"
        :borderColor="BLUE"
        title=" remote · picsum.photos "
        titleAlign="center"
        :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
      >
        <image :src="REMOTE" :width="{ pct: 1 }" :height="{ pct: 1 }" />
      </box>

      <box
        :width="32"
        :height="16"
        :margin="{ left: 2 }"
        border="rounded"
        :borderColor="BLUE"
        title=" bundled · local file "
        titleAlign="center"
        :padding="{ left: 1, right: 1, top: 1, bottom: 1 }"
      >
        <image :src="LOCAL" :width="{ pct: 1 }" :height="{ pct: 1 }" />
      </box>
    </box>

    <text> </text>
    <text :fg="MUTED"
      >Left is fetched over the network (an <b :fg="TEXT">http(s)</b> src is downloaded once, then decoded); right is a
      file bundled with the app. Each is fitted (aspect preserved) to its box.</text
    >
  </box>
</template>

<script setup lang="ts">
import { selectImageEncoding } from '@vui-rs/vue'
import type { DispatchableEvent } from '@vui-rs/vue'

const BG = '#1e1e2e'
const TEXT = '#cdd6f4'
const MUTED = '#9399b2'
const ACCENT = '#cba6f7'
const BLUE = '#89b4fa'
const GREEN = '#a6e3a1'
const RED = '#f38ba8'

// A remote image, fetched over the network by the <image> node.
const REMOTE = 'https://picsum.photos/200/300'
// A bundled asset next to the source; resolve it relative to the built bundle
// (dist/app.js → ../assets/demo.png) so it works regardless of the launch cwd.
const LOCAL = new URL('../assets/demo.png', import.meta.url).pathname
const encoding = selectImageEncoding()

function onKey(ev: DispatchableEvent): void {
  if (ev.type === 'key' && ev.name === 'escape') {
    ev.preventDefault()
    process.exit(0)
  }
}
</script>
