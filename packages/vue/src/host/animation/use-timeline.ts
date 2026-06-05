// `useTimeline()` / `useAnimation()` — the Vue-facing entry to the animation
// engine. They inject the host context (provided at mount) to reach the scheduler-
// owned `AnimationRegistry`, register tweens with it, and auto-cancel every tween
// the component started when it unmounts — so a mounted component can animate
// without leaking the frame loop. Outside a host app (no provider) they degrade
// to ticking the animation directly, which is enough for unit tests.
import { inject, onUnmounted } from "@vue/runtime-core";
import { HostContextSymbol } from "../renderable.ts";
import { type AnimateOptions, type Animation, createAnimation } from "./timeline.ts";

/** A timeline handle: spawn tweens that the component owns and that clean up on unmount. */
export interface Timeline {
  /** Start a tween; it auto-registers with the scheduler and is cancelled on unmount. */
  animate(opts: AnimateOptions): Animation;
  /** Cancel every tween this timeline started (also run automatically on unmount). */
  stop(): void;
}

/**
 * Create a component-scoped timeline. Tweens started via the returned `animate`
 * are driven by the shared frame loop and cancelled when the component unmounts.
 */
export function useTimeline(): Timeline {
  const ctx = inject(HostContextSymbol, null);
  const owned = new Set<Animation>();

  /** Drop a finished/cancelled tween from both the owned set and the frame loop. */
  function retire(anim: Animation): void {
    owned.delete(anim);
    ctx?.animations.remove(anim);
  }

  function register(anim: Animation): void {
    owned.add(anim);
    ctx?.animations.add(anim);
  }

  function animate(opts: AnimateOptions): Animation {
    const inner = createAnimation({
      ...opts,
      onComplete: () => {
        retire(inner);
        opts.onComplete?.();
      },
    });
    register(inner);
    // Wrap so `cancel`/`restart` also (de)register with this timeline's bookkeeping
    // — a re-created tween (e.g. spinner restart) never accumulates dead entries.
    return {
      get value() {
        return inner.value;
      },
      get done() {
        return inner.done;
      },
      get paused() {
        return inner.paused;
      },
      tick: (dt) => inner.tick(dt),
      pause: () => inner.pause(),
      resume: () => inner.resume(),
      cancel: () => {
        inner.cancel();
        retire(inner);
      },
      restart: () => {
        inner.restart();
        register(inner);
      },
    };
  }

  function stop(): void {
    for (const anim of owned) anim.cancel();
    for (const anim of owned) ctx?.animations.remove(anim);
    owned.clear();
  }

  onUnmounted(stop);
  return { animate, stop };
}

/**
 * Convenience wrapper for the common one-tween case: start a single animation and
 * get its handle. Equivalent to `useTimeline().animate(opts)`.
 */
export function useAnimation(opts: AnimateOptions): Animation {
  return useTimeline().animate(opts);
}
