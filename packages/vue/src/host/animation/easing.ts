// Easing functions — pure, runtime-agnostic (no clock, no I/O), so they unit-test
// trivially and the timeline can stay deterministic. Names set
// (`inQuad`/`outQuad`/`inOutQuad`/…) for parity. Each maps a normalized time
// `t ∈ [0,1]` to an eased progress; all satisfy `f(0)=0`, `f(1)=1` (back/elastic
// overshoot in between but still land on the endpoints).

/** An easing curve: normalized time `[0,1]` → eased progress (may overshoot mid-way). */
export type EasingFn = (t: number) => number;

const PI = Math.PI;
const c1 = 1.70158; // back overshoot
const c2 = c1 * 1.525; // inOutBack overshoot
const c3 = c1 + 1;
const c4 = (2 * PI) / 3; // outElastic period
const c5 = (2 * PI) / 4.5; // inOutElastic period
const n1 = 7.5625; // bounce
const d1 = 2.75;

function outBounce(t: number): number {
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** The standard easing catalogue, keyed by name. */
export const easings = {
  linear: (t: number) => t,

  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),

  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  inQuart: (t: number) => t * t * t * t,
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),

  inSine: (t: number) => 1 - Math.cos((t * PI) / 2),
  outSine: (t: number) => Math.sin((t * PI) / 2),
  inOutSine: (t: number) => -(Math.cos(PI * t) - 1) / 2,

  inExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t === 0 ? 0
    : t === 1 ? 1
    : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2,

  inCirc: (t: number) => 1 - Math.sqrt(1 - t * t),
  outCirc: (t: number) => Math.sqrt(1 - Math.pow(t - 1, 2)),
  inOutCirc: (t: number) =>
    t < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

  inBack: (t: number) => c3 * t * t * t - c1 * t * t,
  outBack: (t: number) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t: number) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,

  inElastic: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4),
  outElastic: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
  inOutElastic: (t: number) =>
    t === 0 ? 0
    : t === 1 ? 1
    : t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,

  inBounce: (t: number) => 1 - outBounce(1 - t),
  outBounce,
  inOutBounce: (t: number) =>
    t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2,
} satisfies Record<string, EasingFn>;

/** Name of a built-in easing curve. */
export type EasingName = keyof typeof easings;

/** Resolve an easing name (or a custom function) to a callable curve; unknown → linear. */
export function resolveEasing(easing: EasingName | EasingFn | undefined): EasingFn {
  if (typeof easing === "function") return easing;
  if (easing && easing in easings) return easings[easing];
  return easings.linear;
}
