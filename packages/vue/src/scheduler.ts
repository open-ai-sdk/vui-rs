// Two-layer render coalescing. Layer 1: a whole reactive batch collapses to one
// flush via Vue's `queuePostFlushCb` (queued at most once per batch), so N writes
// in a tick produce exactly one `render()`. Layer 2: a ~16ms frame throttle
// (leading + trailing, like pi's `MIN_RENDER_INTERVAL_MS`) so a burst of batches
// across ticks never renders faster than a frame, and the final frame is never
// dropped. Staged style/text/free mutations are applied just before each render.
import { queuePostFlushCb } from "@vue/runtime-core";
import { type VuiContext, type VuiHostNode } from "./host-node.ts";
import { flattenRuns } from "./runs.ts";

const FRAME_MS = 16;

export interface Scheduler {
  scheduleRender: () => void;
  flushNow: () => void;
  dispose: () => void;
}

export function createScheduler(ctx: VuiContext): Scheduler {
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

  /** Bypass the throttle: apply staged mutations and render now. */
  function flushNow(): void {
    clearTrailing();
    render();
  }

  /**
   * Stop the scheduler for good. A post-flush callback queued during unmount can
   * fire after the renderer is freed; disposing closes that window (no render
   * touches the freed renderer) and cancels any pending trailing frame.
   */
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
    if (disposed || !ctx.renderer) return;
    lastRenderAt = Date.now();
    applyStaged(ctx);
    ctx.renderer.render();
    ctx.renderCount++;
  }

  return { scheduleRender, flushNow, dispose };
}

/** Push every staged JS-side change into Rust, then free removed nodes. */
function applyStaged(ctx: VuiContext): void {
  for (const node of ctx.dirtyStyle) node.core?.setStyle(node.styleCache);
  ctx.dirtyStyle.clear();

  for (const text of ctx.dirtyText) text.core?.setTextRuns(flattenRuns(text));
  ctx.dirtyText.clear();

  if (ctx.pendingFree.length > 0) {
    for (const node of ctx.pendingFree) {
      // Already reclaimed as part of an ancestor's subtree free — skip.
      if (!node.core || !ctx.liveNative.has(node)) continue;
      // `free()` destroys the whole Rust subtree, so Vue need not remove every
      // descendant (it unmounts children with doRemove=false). Drop the entire
      // host subtree from the live set to match what Rust reclaims.
      forgetSubtree(ctx, node);
      try {
        node.core.free();
      } catch {
        // Defensive: a stale handle (already freed) is a no-op, not a crash.
      }
    }
    ctx.pendingFree.length = 0;
  }
}

/** Remove `node` and all its descendants from the live-native set (DFS). */
function forgetSubtree(ctx: VuiContext, node: VuiHostNode): void {
  const stack = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.core) ctx.liveNative.delete(n);
    for (const child of n.children) stack.push(child);
  }
}
