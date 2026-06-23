// Opt-in JS-host render timing, the twin of the native `perf` module and gated
// the same way: `VUI_PERF` set ⇒ on, unset ⇒ zero-cost (one module-const boolean
// check, no allocation, on the hot paths). This is where the red-team expects the
// real per-frame cost to live — the `readRects` full-tree FFI fan-out and the
// ungated paint walk — so it times `runLayout`'s readRects, counts the per-node
// `layoutRect()` FFI crossings, counts paint node-visits, and records the
// inter-frame wall-gap (to correlate with a host app's own render cadence).
//
// Output goes to **stderr** with a `vui-perf-js` prefix (distinct from the native
// `vui-perf` line and from any host-app perf logs), flushed once every `FLUSH_EVERY`
// frames. Nothing here alters render behaviour.

export const perfEnabled = !!process.env.VUI_PERF

/**
 * Per-node hot-path counters mutated directly from `readRects` (layout.ts) and
 * `paintNode` (paint-walk.ts), guarded at the call site by `perfEnabled`. Folded
 * into the window on each `recordFrame` and reset there.
 */
export const counters = { layoutRectCalls: 0, paintVisits: 0 }

const FLUSH_EVERY = 30

const now = (): number => performance.now()

interface Window {
  frames: number
  lastEntry: number
  gapTotal: number
  gapMax: number
  layoutTotal: number
  layoutMax: number
  readRectsTotal: number
  paintTotal: number
  paintMax: number
  rectCalls: number
  paintVisits: number
  dirtyTextTotal: number
  dirtyTextMax: number
  dirtyLayoutTotal: number
}

function fresh(): Window {
  return {
    frames: 0,
    lastEntry: 0,
    gapTotal: 0,
    gapMax: 0,
    layoutTotal: 0,
    layoutMax: 0,
    readRectsTotal: 0,
    paintTotal: 0,
    paintMax: 0,
    rectCalls: 0,
    paintVisits: 0,
    dirtyTextTotal: 0,
    dirtyTextMax: 0,
    dirtyLayoutTotal: 0,
  }
}

const w = fresh()

/** Stamp a `render()` entry; folds the wall-gap since the previous entry. */
export function markRenderEntry(at: number): void {
  if (w.lastEntry !== 0) {
    const gap = at - w.lastEntry
    w.gapTotal += gap
    if (gap > w.gapMax) w.gapMax = gap
  }
  w.lastEntry = at
}

/** Time the `runLayout` readRects walk in isolation (the FFI-fan-out suspect). */
export function recordReadRects(ms: number): void {
  w.readRectsTotal += ms
}

/**
 * Record how many nodes the host marked dirty this layout — the host-vs-native
 * discriminator for a re-measure explosion. High dirtyText ⇒ Vue re-rendered the
 * tree (host-side); low dirty with high native measure_calls ⇒ Taffy re-measures
 * despite few changes (native/available-space side).
 */
export function recordDirty(dirtyLayout: number, dirtyText: number): void {
  w.dirtyLayoutTotal += dirtyLayout
  w.dirtyTextTotal += dirtyText
  if (dirtyText > w.dirtyTextMax) w.dirtyTextMax = dirtyText
}

/** A timing helper: returns `performance.now()` only when perf is on (else 0). */
export const perfNow = (): number => (perfEnabled ? now() : 0)

/**
 * Fold one frame: total layout time (incl. computeLayout FFI + readRects) and
 * paint-walk time as measured by the scheduler. Drains the per-node counters and
 * flushes a `vui-perf-js` line every `FLUSH_EVERY` frames.
 */
export function recordFrame(layoutMs: number, paintMs: number): void {
  w.frames++
  w.layoutTotal += layoutMs
  if (layoutMs > w.layoutMax) w.layoutMax = layoutMs
  w.paintTotal += paintMs
  if (paintMs > w.paintMax) w.paintMax = paintMs
  w.rectCalls += counters.layoutRectCalls
  w.paintVisits += counters.paintVisits
  counters.layoutRectCalls = 0
  counters.paintVisits = 0
  if (w.frames >= FLUSH_EVERY) {
    emitLine()
    const keepEntry = w.lastEntry
    Object.assign(w, fresh())
    w.lastEntry = keepEntry // preserve gap continuity across windows
  }
}

function emitLine(): void {
  const f = w.frames || 1
  const line =
    `vui-perf-js frames=${w.frames} ` +
    `gap_avg=${(w.gapTotal / f).toFixed(2)}ms gap_max=${w.gapMax.toFixed(2)}ms ` +
    `layout_avg=${(w.layoutTotal / f).toFixed(3)}ms layout_max=${w.layoutMax.toFixed(3)}ms ` +
    `readRects_avg=${(w.readRectsTotal / f).toFixed(3)}ms ` +
    `rectCalls_avg=${(w.rectCalls / f).toFixed(0)} ` +
    `paint_avg=${(w.paintTotal / f).toFixed(3)}ms paint_max=${w.paintMax.toFixed(3)}ms ` +
    `visits_avg=${(w.paintVisits / f).toFixed(0)} ` +
    `dirtyText_avg=${(w.dirtyTextTotal / f).toFixed(0)} dirtyText_max=${w.dirtyTextMax.toFixed(0)} ` +
    `dirtyLayout_avg=${(w.dirtyLayoutTotal / f).toFixed(0)}`
  process.stderr.write(line + '\n')
}
