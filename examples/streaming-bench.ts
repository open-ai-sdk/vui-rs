#!/usr/bin/env bun
// Streaming-render diagnostic: reproduces a chat app's token-by-token append into
// a large transcript WITHOUT a live LLM, so the per-frame render cost can be
// profiled headlessly. A transcript of `MSGS` bubbles (each a bordered box of
// several text rows, taller than the screen so it scrolls) is built once, then a
// single reactive `streaming` string on the LAST bubble grows one token at a
// time — exactly the real hot path: each token dirties one text node in a big
// tree, and the host re-lays-out + repaints.
//
// Run with the perf gate to capture the phase timings:
//   VUI_PERF=1 bun run examples/streaming-bench.ts 2>&1 | grep vui-perf
//
// This isolates the RENDER cost at transcript scale (measure call count,
// readRects FFI fan-out, paint node visits). It does NOT model token ARRIVAL
// pacing — the render-bound-vs-arrival-bound question (Q0) still needs the live
// 54-message session — but it answers Q1 (which walk scales with transcript size)
// and whether per-token native frame time sits under the 16ms budget.
import { Renderer } from '@vui-rs/core'
import { createHostApp, defineComponent, h, nextTick, ref } from '@vui-rs/vue'

const W = 100
const H = 40
const MSGS = Number(process.argv[2] ?? 54) // transcript size (default 54)
const TOKENS = Number(process.argv[3] ?? 300) // tokens streamed into the last bubble

// A few lines of static prose per prior message — enough rows that MSGS bubbles
// overflow H and the transcript scrolls (mirrors a real chat backlog).
const PROSE = [
  'The quick brown fox jumps over the lazy dog near the river bank.',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do.',
  'Streaming tokens into a tall scroll-box is the scenario under test.',
  'Each prior bubble is static; only the last one grows per token.',
]

function transcriptApp(streaming: { value: string }) {
  return defineComponent({
    setup() {
      return () =>
        h('box', { width: W, height: H, overflow: 'scroll', flexDirection: 'column', scrollY: 1_000_000 }, [
          // Static backlog: MSGS-1 bubbles that never change after build.
          ...Array.from({ length: MSGS - 1 }, (_, i) =>
            h(
              'box',
              { border: 'single', flexDirection: 'column', marginBottom: 1 },
              PROSE.map((line) => h('text', { fg: 0xcdd6f4ff }, `${i}: ${line}`)),
            ),
          ),
          // The live bubble: its text is the reactive streaming string.
          h('box', { border: 'single', flexDirection: 'column', marginBottom: 1 }, [
            h('text', { fg: 0xa6e3a1ff }, streaming.value),
          ]),
        ])
    },
  })
}

async function main(): Promise<void> {
  console.error(`streaming-bench — ${W}x${H}, ${MSGS} messages, ${TOKENS} tokens into the last bubble`)
  console.error(`(perf lines require VUI_PERF=1; ${process.env.VUI_PERF ? 'ENABLED' : 'disabled'})\n`)

  const streaming = ref('')
  const r = new Renderer(W, H)
  const app = createHostApp(transcriptApp(streaming)).mount({ renderer: r })
  app.context.flushNow() // build + lay out the full backlog once

  // Stream tokens: each append dirties exactly the last text node, then we force
  // the frame the way the scheduler would after a coalesced reactive update.
  const samples: number[] = []
  for (let i = 0; i < TOKENS; i++) {
    streaming.value += i % 9 === 8 ? ` word${i} ` : `tok${i} `
    // Let Vue re-render the component and patch the host tree (this is what marks
    // the streaming text node dirty + calls scheduleRender) BEFORE forcing the
    // frame, so each measured flush reflects a real per-token layout+paint.
    await nextTick()
    const t0 = performance.now()
    app.context.flushNow()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]!
  const p95 = samples[Math.floor(samples.length * 0.95)]!
  const max = samples[samples.length - 1]!
  console.error(
    `\nper-token full frame (JS host flushNow): median=${median.toFixed(3)}ms ` +
      `p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms (budget 16ms)`,
  )

  app.unmount()
  r.free()
}

await main()
