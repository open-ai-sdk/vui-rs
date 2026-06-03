#!/usr/bin/env bun
// Phase 06 benchmark: JS host (JS paint walk) vs FFI host (Rust tree paint), the
// gate for the default-flip. Renders the same tree into an OFFSCREEN renderer
// (no tty) and times repeated forced re-renders. Reports ms/frame for small,
// large, and animated trees, plus the JS↔Rust ratio.
//
//   bun run bench/paint-bench.ts
import { Renderer } from "@vui-rs/core";
import {
  computed,
  createApp,
  createHostApp,
  defineComponent,
  h,
  nextTick,
  ref,
} from "@vui-rs/vue";

const W = 120;
const H = 40;
const ITERS = 200;

/** A K-cell grid of bordered boxes each holding a text label — a realistic tree. */
function gridApp(cols: number, rows: number, tick: { value: number }) {
  return defineComponent({
    setup() {
      return () =>
        h(
          "box",
          { width: W, height: H, flexDirection: "column" },
          Array.from({ length: rows }, (_, r) =>
            h(
              "box",
              { flexDirection: "row", height: 2 },
              Array.from({ length: cols }, (_, c) =>
                h(
                  "box",
                  { width: 10, height: 2, border: "single", bg: (r + c + tick.value) % 2 ? 0x202030ff : 0x101018ff },
                  [h("text", { fg: 0xcdd6f4ff }, `${c},${r}`)],
                ),
              ),
            ),
          ),
        );
    },
  });
}

/** Median ms over `iters` forced renders; `mutate` changes state to dirty the tree. */
function timeRenders(flush: () => void, mutate: () => void, iters: number): number {
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    mutate();
    const t0 = performance.now();
    flush();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function benchFfi(App: ReturnType<typeof defineComponent>, tick: { value: number }, iters: number): number {
  const r = new Renderer(W, H);
  const app = createApp(App).mount({ renderer: r, altScreen: false });
  const ms = timeRenders(() => app.context.flushNow(), () => tick.value++, iters);
  app.unmount();
  r.free();
  return ms;
}

function benchJs(App: ReturnType<typeof defineComponent>, tick: { value: number }, iters: number): number {
  const r = new Renderer(W, H);
  const app = createHostApp(App).mount({ renderer: r });
  const ms = timeRenders(() => app.context.flushNow(), () => tick.value++, iters);
  app.unmount();
  r.free();
  return ms;
}

function row(label: string, ffi: number, js: number): void {
  const ratio = js / ffi;
  console.error(
    `${label.padEnd(22)} ffi=${ffi.toFixed(3)}ms  js=${js.toFixed(3)}ms  js/ffi=${ratio.toFixed(2)}x`,
  );
}

async function main(): Promise<void> {
  console.error(`paint benchmark — ${W}x${H}, median of ${ITERS} forced renders\n`);
  const cases: Array<[string, number, number]> = [
    ["small (2x2 grid)", 2, 2],
    ["medium (6x6 grid)", 6, 6],
    ["large (10x8 grid)", 10, 8],
  ];
  for (const [label, cols, rows] of cases) {
    const tickFfi = ref(0);
    const tickJs = ref(0);
    const ffi = benchFfi(gridApp(cols, rows, tickFfi), tickFfi, ITERS);
    const js = benchJs(gridApp(cols, rows, tickJs), tickJs, ITERS);
    const n = cols * rows;
    row(`${label} ~${n * 2}n`, ffi, js);
  }
  // Idle check: after one render, no mutation → the on-demand scheduler is quiet.
  const idleTick = ref(0);
  const r = new Renderer(W, H);
  const app = createHostApp(gridApp(4, 4, idleTick)).mount({ renderer: r });
  const before = app.context.renderCount;
  await nextTick();
  await nextTick();
  console.error(`\nidle renders over 2 ticks (on-demand): ${app.context.renderCount - before} (expect 0)`);
  app.unmount();
  r.free();
}

await main();
