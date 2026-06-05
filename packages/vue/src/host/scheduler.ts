// Render coalescing for the JS host — the same two-layer model as the FFI
// scheduler (Vue post-flush batch + ~16ms frame throttle). Each render runs the
// layout pass (dirty-gated, Phase 03) then the paint walk (Phase 04), both wired
// as optional ctx hooks so Phase 01 can mount and build the tree with no paint.
//
// It also owns the animation frame loop: while any animation is active it ticks
// the registry every frame with a real-clock delta (the scheduler is allowed to
// read the clock; the pure timeline module is not). Each tick sets reactive refs,
// which flow through Vue → `scheduleRender` → the throttle below, so the loop
// only *advances time* and never paints directly (no second render cadence). When
// the last animation finishes the loop stops, restoring zero-render-on-idle.
import { queuePostFlushCb } from "@vue/runtime-core";
import { type AnimationRegistry, createAnimationRegistry } from "./animation/timeline.ts";
import { type HostContext } from "./renderable.ts";

const FRAME_MS = 16;
// Clamp the per-frame delta so a long pause (GC, blocked event loop) can't make
// an animation leap or spin the carry loop; it just resumes a few frames behind.
const MAX_DT_MS = 100;

export interface HostScheduler {
  scheduleRender: () => void;
  flushNow: () => void;
  dispose: () => void;
  animations: AnimationRegistry;
}

export function createHostScheduler(ctx: HostContext): HostScheduler {
  let flushQueued = false;
  let lastRenderAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTimer: ReturnType<typeof setInterval> | null = null;
  let lastFrameAt = 0;
  let disposed = false;

  const animations = createAnimationRegistry(setAnimating);

  function scheduleRender(): void {
    if (disposed || flushQueued) return;
    flushQueued = true;
    queuePostFlushCb(onFlush);
  }

  function onFlush(): void {
    flushQueued = false;
    if (disposed) return;
    const since = Date.now() - lastRenderAt;
    if (since >= FRAME_MS) {
      render();
    } else if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        render();
      }, FRAME_MS - since);
    }
  }

  function flushNow(): void {
    clearTrailing();
    render();
  }

  function dispose(): void {
    disposed = true;
    clearTrailing();
    stopFrames();
    animations.clear();
  }

  function clearTrailing(): void {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  }

  // --- Animation frame loop --------------------------------------------------

  /** Empty↔non-empty edge from the registry: start the loop, or stop it when idle. */
  function setAnimating(active: boolean): void {
    if (active) startFrames();
    else stopFrames();
  }

  function startFrames(): void {
    if (frameTimer || disposed) return;
    lastFrameAt = Date.now();
    frameTimer = setInterval(onFrame, FRAME_MS);
  }

  function stopFrames(): void {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }

  function onFrame(): void {
    if (disposed) {
      stopFrames();
      return;
    }
    const now = Date.now();
    const dt = Math.min(MAX_DT_MS, now - lastFrameAt);
    lastFrameAt = now;
    // Advance animations only; `onUpdate` sets refs → coalesced render. If this
    // drains the registry, `setAnimating(false)` stops the loop for us.
    animations.tick(dt);
  }

  function render(): void {
    if (disposed) return;
    lastRenderAt = Date.now();
    ctx.layout?.(ctx); // dirty-gated layout (Phase 03)
    // Post-layout, pre-paint: viewports clamp/stick their scroll offset to the
    // freshly-laid-out content size (stick-to-bottom with no one-frame lag).
    for (const cb of ctx.afterLayout) cb();
    ctx.paint?.(ctx); // tree walk + native diff/emit (Phase 04)
    ctx.renderCount++;
  }

  return { scheduleRender, flushNow, dispose, animations };
}
