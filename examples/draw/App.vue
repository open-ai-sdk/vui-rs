<!-- draw-primitives reproduced as a <canvas @draw>: the immediate-mode native
     panel (border + styled text + color swatches + wide chars), now drawn from a
     clamped, clipped CanvasContext on the JS host. The capability the whole
     re-architecture was for. -->
<template>
  <canvas :width="48" :height="13" @draw="draw" />
</template>

<script setup lang="ts">
import { Attr, type CanvasContext, rgba } from '@vui-rs/vue'

const BG = rgba(17, 17, 27)
const PANEL = rgba(24, 24, 37)
const ACCENT = rgba(137, 180, 250)
const TEXT = rgba(205, 214, 244)
const DIM = rgba(127, 132, 156)

function border(ctx: CanvasContext, color: number, bg: number): void {
  const w = ctx.width
  const h = ctx.height
  ctx.drawText(0, 0, '┌' + '─'.repeat(w - 2) + '┐', { fg: color, bg })
  ctx.drawText(0, h - 1, '└' + '─'.repeat(w - 2) + '┘', { fg: color, bg })
  for (let y = 1; y < h - 1; y++) {
    ctx.setCell(0, y, '│', { fg: color, bg })
    ctx.setCell(w - 1, y, '│', { fg: color, bg })
  }
}

function draw(ctx: CanvasContext): void {
  ctx.clear(BG)
  ctx.fillRect(0, 0, ctx.width, ctx.height, PANEL)
  border(ctx, ACCENT, PANEL)

  ctx.drawText(2, 1, ' vui-rs · <canvas @draw> ', { fg: BG, bg: ACCENT, attrs: Attr.BOLD })
  ctx.drawText(2, 3, 'Custom drawing on the JS host.', { fg: TEXT, bg: PANEL })
  ctx.drawText(2, 5, 'bold', { fg: TEXT, bg: PANEL, attrs: Attr.BOLD })
  ctx.drawText(7, 5, 'italic', { fg: TEXT, bg: PANEL, attrs: Attr.ITALIC })
  ctx.drawText(14, 5, 'underline', { fg: TEXT, bg: PANEL, attrs: Attr.UNDERLINE })
  ctx.drawText(24, 5, 'inverse', { fg: TEXT, bg: PANEL, attrs: Attr.INVERSE })
  ctx.drawText(2, 7, 'colors:', { fg: TEXT, bg: PANEL })
  ctx.drawText(10, 7, '■', { fg: rgba(243, 139, 168), bg: PANEL })
  ctx.drawText(12, 7, '■', { fg: rgba(166, 227, 161), bg: PANEL })
  ctx.drawText(14, 7, '■', { fg: rgba(249, 226, 175), bg: PANEL })
  ctx.drawText(16, 7, '■', { fg: rgba(137, 220, 235), bg: PANEL })
  ctx.drawText(2, 9, 'wide chars: 你好 · 世界 · 🦀', { fg: TEXT, bg: PANEL })
  ctx.drawText(2, 11, 'Ctrl-C to exit', { fg: DIM, bg: PANEL, attrs: Attr.DIM })
}
</script>
