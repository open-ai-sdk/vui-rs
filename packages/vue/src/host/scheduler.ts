// Render coalescing for the JS host — the same two-layer model as the FFI
// scheduler (Vue post-flush batch + ~16ms frame throttle). Each render runs the
// layout pass (dirty-gated, Phase 03) then the paint walk (Phase 04), both wired
// as optional ctx hooks so Phase 01 can mount and build the tree with no paint.
import { queuePostFlushCb } from "@vue/runtime-core";
import { type HostContext } from "./renderable.ts";

const FRAME_MS = 16;

export interface HostScheduler {
  scheduleRender: () => void;
  flushNow: () => void;
  dispose: () => void;
}

export function createHostScheduler(ctx: HostContext): HostScheduler {
  let flushQueued = false;
  let lastRenderAt = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

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
  }

  function clearTrailing(): void {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  }

  function render(): void {
    if (disposed) return;
    lastRenderAt = Date.now();
    ctx.layout?.(ctx); // dirty-gated layout (Phase 03)
    ctx.paint?.(ctx); // tree walk + native diff/emit (Phase 04)
    ctx.renderCount++;
  }

  return { scheduleRender, flushNow, dispose };
}
