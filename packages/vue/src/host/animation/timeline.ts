// The animation engine — pure and runtime-agnostic (the `wrap.ts` pattern): it
// never reads the clock. Time is supplied as a delta (`dt`, ms) by whoever drives
// it (the scheduler's frame loop), so animations are fully deterministic and
// unit-testable by hand-ticking. An `Animation` tweens one number `from → to`
// over `duration`, feeding each value to `onUpdate` (which a Vue component wires
// to a reactive ref → the existing coalesced render). The `AnimationRegistry`
// holds the active set and reports empty↔non-empty so the scheduler can run a
// frame loop only while something is animating (keeps zero-render-on-idle).
import { type EasingFn, type EasingName, resolveEasing } from "./easing.ts";

/** Options for a single number tween. */
export interface AnimateOptions {
  /** Start value. */
  from: number;
  /** End value. */
  to: number;
  /** Tween length in milliseconds (≤0 = apply `to` immediately). */
  duration: number;
  /** Easing curve (name or custom fn); default `linear`. */
  easing?: EasingName | EasingFn;
  /** Milliseconds to wait before the tween starts. */
  delay?: number;
  /** `true` = loop forever, a number = repeat that many times, else play once. */
  loop?: boolean | number;
  /** Ping-pong: reverse direction every loop so it goes `from→to→from→…`. */
  alternate?: boolean;
  /** Called with each tweened value (wire to a reactive ref). */
  onUpdate: (value: number) => void;
  /** Called once when the tween finishes naturally (not on `cancel`). */
  onComplete?: () => void;
}

/** A running tween. The scheduler drives it via `tick`; components control it via pause/resume/cancel. */
export interface Animation {
  /** Latest emitted value. */
  readonly value: number;
  /** True once finished or cancelled (the registry prunes it). */
  readonly done: boolean;
  /** True while paused (ticks are ignored). */
  readonly paused: boolean;
  /** Advance by `dt` ms; emits an updated value and fires completion/loop logic. */
  tick(dt: number): void;
  /** Suspend ticking (value frozen) until `resume`. */
  pause(): void;
  /** Resume ticking after `pause`. */
  resume(): void;
  /** Stop immediately without firing `onComplete`; marks `done` so the registry drops it. */
  cancel(): void;
  /** Rewind to the start (re-arms delay and loops) and un-pause. */
  restart(): void;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function createAnimation(opts: AnimateOptions): Animation {
  const ease = resolveEasing(opts.easing);
  const duration = Math.max(0, opts.duration);
  const totalLoops =
    opts.loop === true ? Infinity
    : typeof opts.loop === "number" ? Math.max(1, Math.floor(opts.loop))
    : 1;
  const initialDelay = Math.max(0, opts.delay ?? 0);

  let delayLeft = initialDelay;
  let elapsed = 0; // ms into the current loop iteration
  let loopsDone = 0;
  let done = false;
  let paused = false;
  let value = opts.from;

  /** Map an iteration-local normalized time to the eased output, honoring alternate. */
  function valueAt(t: number): number {
    let p = clamp01(t);
    if (opts.alternate && loopsDone % 2 === 1) p = 1 - p;
    return opts.from + (opts.to - opts.from) * ease(p);
  }

  function emit(t: number): void {
    value = valueAt(t);
    opts.onUpdate(value);
  }

  function tick(dt: number): void {
    if (done || paused || dt <= 0) return;
    if (delayLeft > 0) {
      if (dt < delayLeft) {
        delayLeft -= dt;
        return;
      }
      dt -= delayLeft;
      delayLeft = 0;
    }
    if (duration === 0) {
      // Instant tween: land on the final value and finish (or loop once per tick).
      loopsDone = totalLoops === Infinity ? 1 : totalLoops;
      emit(1);
      done = true;
      opts.onComplete?.();
      return;
    }
    elapsed += dt;
    // Consume whole iterations; `dt` is clamped by the scheduler so this is bounded.
    for (;;) {
      const t = elapsed / duration;
      if (t < 1) {
        emit(t);
        return;
      }
      loopsDone++;
      if (loopsDone >= totalLoops) {
        emit(1);
        done = true;
        opts.onComplete?.();
        return;
      }
      elapsed -= duration; // carry the remainder into the next iteration
    }
  }

  return {
    get value() {
      return value;
    },
    get done() {
      return done;
    },
    get paused() {
      return paused;
    },
    tick,
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    cancel() {
      done = true; // no onComplete — cancellation is silent
    },
    restart() {
      delayLeft = initialDelay;
      elapsed = 0;
      loopsDone = 0;
      done = false;
      paused = false;
      value = opts.from;
    },
  };
}

/**
 * Holds the active animations and drives them as a batch. `onActive(true|false)`
 * fires on the empty↔non-empty edge so the scheduler starts/stops its frame loop
 * (no loop while idle). The registry itself owns no timer — it is ticked from the
 * outside with the frame delta.
 */
export interface AnimationRegistry {
  add(a: Animation): void;
  remove(a: Animation): void;
  readonly size: number;
  /** Advance every animation by `dt` ms, then drop the ones that finished. */
  tick(dt: number): void;
  /** Drop all animations (used on dispose). */
  clear(): void;
}

export function createAnimationRegistry(
  onActive: (active: boolean) => void,
): AnimationRegistry {
  const set = new Set<Animation>();

  return {
    add(a) {
      if (set.has(a)) return;
      const wasEmpty = set.size === 0;
      set.add(a);
      if (wasEmpty) onActive(true);
    },
    remove(a) {
      if (set.delete(a) && set.size === 0) onActive(false);
    },
    get size() {
      return set.size;
    },
    tick(dt) {
      for (const a of set) {
        a.tick(dt);
        if (a.done) set.delete(a);
      }
      if (set.size === 0) onActive(false);
    },
    clear() {
      const had = set.size > 0;
      set.clear();
      if (had) onActive(false);
    },
  };
}
