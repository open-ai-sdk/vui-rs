#!/usr/bin/env bun
// Phase 06 benchmark: JS host (JS paint walk) vs FFI host (Rust tree paint), the
// gate for the default-flip. Renders the same tree into an OFFSCREEN renderer
// (no tty) and times repeated forced re-renders. Reports ms/frame for small,
// large, and animated trees, plus the JS↔Rust ratio.
//
//   bun run bench/paint-bench.ts
import { Renderer } from '@vui-rs/core'
import { computed, createHostApp, defineComponent, h, nextTick, ref } from '@vui-rs/vue'

const W = 120
const H = 40
const ITERS = 200

/** A K-cell grid of bordered boxes each holding a text label — a realistic tree. */
function gridApp(cols: number, rows: number, tick: { value: number }) {
  return defineComponent({
    setup() {
      return () =>
        h(
          'box',
          { width: W, height: H, flexDirection: 'column' },
          Array.from({ length: rows }, (_, r) =>
            h(
              'box',
              { flexDirection: 'row', height: 2 },
              Array.from({ length: cols }, (_, c) =>
                h(
                  'box',
                  { width: 10, height: 2, border: 'single', bg: (r + c + tick.value) % 2 ? 0x202030ff : 0x101018ff },
                  [h('text', { fg: 0xcdd6f4ff }, `${c},${r}`)],
                ),
              ),
            ),
          ),
        )
    },
  })
}

/**
 * A scrollable viewport of `n` one-row text lines, taller than the screen. Used
 * to prove paint-walk culling: only the ~H visible rows pay paint cost, so the
 * frame time is ~constant in `n` (off-screen rows are skipped, not drawn).
 */
function scrollApp(n: number, scroll: { value: number }) {
  return defineComponent({
    setup() {
      return () =>
        h(
          'box',
          { width: W, height: H, overflow: 'scroll', flexDirection: 'column', scrollY: scroll.value },
          Array.from({ length: n }, (_, i) => h('text', { fg: 0xcdd6f4ff }, `line ${i}`)),
        )
    },
  })
}

/** Median ms over `iters` forced renders; `mutate` changes state to dirty the tree. */
function timeRenders(flush: () => void, mutate: () => void, iters: number): number {
  const samples: number[] = []
  for (let i = 0; i < iters; i++) {
    mutate()
    const t0 = performance.now()
    flush()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

function benchHost(App: ReturnType<typeof defineComponent>, tick: { value: number }, iters: number): number {
  const r = new Renderer(W, H)
  const app = createHostApp(App).mount({ renderer: r })
  const ms = timeRenders(
    () => app.context.flushNow(),
    () => tick.value++,
    iters,
  )
  app.unmount()
  r.free()
  return ms
}

/**
 * Time pure paint of a scrolled `n`-row viewport. The tree is built once; each
 * iteration only nudges the scroll offset on the renderable (no Vue re-render, no
 * relayout — both dirty-gated off), so the median is the paint walk alone.
 * Culling should make this ~flat across `n`.
 */
function benchScroll(n: number, iters: number): number {
  const scroll = { value: 0 }
  const r = new Renderer(W, H)
  const app = createHostApp(scrollApp(n, scroll)).mount({ renderer: r })
  app.context.flushNow() // one-time layout of all n rows
  const box = app.context.root!.children[0]!
  const max = Math.max(0, n - H)
  let i = 0
  const ms = timeRenders(
    () => app.context.flushNow(),
    () => {
      i = max === 0 ? 0 : (i + 1) % (max + 1)
      box.scrollY = i
      box.markDirty()
    },
    iters,
  )
  app.unmount()
  r.free()
  return ms
}

async function main(): Promise<void> {
  console.error(`paint benchmark (JS host) — ${W}x${H}, median of ${ITERS} forced renders\n`)
  const cases: Array<[string, number, number]> = [
    ['small (2x2 grid)', 2, 2],
    ['medium (6x6 grid)', 6, 6],
    ['large (10x8 grid)', 10, 8],
  ]
  for (const [label, cols, rows] of cases) {
    const tick = ref(0)
    const ms = benchHost(gridApp(cols, rows, tick), tick, ITERS)
    const n = cols * rows
    console.error(`${`${label} ~${n * 2}n`.padEnd(24)} ${ms.toFixed(3)} ms/frame`)
  }
  // Culling: only the ~H visible rows are drawn, so paint grows SUBLINEARLY in
  // the row count — 10x the rows costs far less than 10x the time (the residual
  // is the cheap O(children) cull scan; true O(visible) awaits <virtual-list>).
  console.error('')
  for (const n of [500, 5000]) {
    const ms = benchScroll(n, ITERS)
    console.error(`${`scroll viewport ${n}n`.padEnd(24)} ${ms.toFixed(3)} ms/frame (paint, ~${H} drawn)`)
  }

  // Idle check: after one render, no mutation → the on-demand scheduler is quiet.
  const idleTick = ref(0)
  const r = new Renderer(W, H)
  const app = createHostApp(gridApp(4, 4, idleTick)).mount({ renderer: r })
  const before = app.context.renderCount
  await nextTick()
  await nextTick()
  console.error(`\nidle renders over 2 ticks (on-demand): ${app.context.renderCount - before} (expect 0)`)
  app.unmount()
  r.free()
}

await main()
