// `<VuiSpinner>` — a small animated busy indicator built from the built-in `text`
// element + the animation engine. It demonstrates the intended extensibility
// path: custom widgets are plain Vue components composing existing kinds, needing
// no Rust/core change. Color defaults to the theme accent and can be overridden;
// the frame index is driven by a looping tween on the shared frame loop, so it
// stays in lock-step with every other animation and stops cleanly on unmount
// (no private timer; idle apps keep zero-render-on-idle).
import {
  type PropType,
  computed,
  defineComponent,
  h,
  shallowRef,
  watch,
} from "@vue/runtime-core";
import { parseColor } from "@vui-rs/core";
import { useTimeline } from "../host/animation/use-timeline.ts";
import type { Animation } from "../host/animation/timeline.ts";
import { useTheme } from "../use-theme.ts";

type ColorProp = string | number;

/** Built-in spinner frame sets, selectable via the `preset` prop. */
export const SPINNER_PRESETS = {
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots: ["⢄", "⢂", "⢁", "⡁", "⡈", "⡐", "⡠"],
  line: ["-", "\\", "|", "/"],
} as const;

export type SpinnerPreset = keyof typeof SPINNER_PRESETS;

export const VuiSpinner = defineComponent({
  name: "VuiSpinner",
  props: {
    /** Animation frames, cycled in order. Overrides `preset` when set. */
    frames: { type: Array as PropType<string[]>, default: undefined },
    /** Named built-in frame set; ignored when `frames` is provided. */
    preset: { type: String as PropType<SpinnerPreset>, default: "braille" },
    /** Milliseconds between frames. */
    interval: { type: Number, default: 80 },
    /** Spinner color; defaults to the active theme's accent. */
    color: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    /** Optional label rendered after the spinner glyph. */
    label: { type: String, default: "" },
  },
  setup(props) {
    const theme = useTheme();
    const timeline = useTimeline();
    const index = shallowRef(0);
    const fg = computed(() => (props.color != null ? parseColor(props.color) : theme.accent));
    const frames = computed(() =>
      props.frames && props.frames.length > 0 ? props.frames : SPINNER_PRESETS[props.preset],
    );
    let anim: Animation | null = null;

    // (Re)start the looping tween whenever the frame count or speed changes. The
    // tween sweeps 0 → n over one full cycle; flooring the value gives the index,
    // and assigning the same index is a no-op for Vue's reactivity, so a repaint
    // only happens on an actual frame change (not every 16ms tick).
    function restart(): void {
      anim?.cancel();
      const n = frames.value.length;
      if (n === 0) {
        anim = null;
        return;
      }
      anim = timeline.animate({
        from: 0,
        to: n,
        duration: Math.max(1, props.interval) * n,
        easing: "linear",
        loop: true,
        onUpdate: (v) => {
          index.value = Math.floor(v) % n;
        },
      });
    }

    watch(
      () => [frames.value.length, props.interval] as const,
      restart,
      { immediate: true },
    );

    return () => {
      const fs = frames.value;
      const glyph = fs[index.value % (fs.length || 1)] ?? "";
      const content = props.label ? `${glyph} ${props.label}` : glyph;
      // Self-size to one row of the content so the spinner renders standalone
      // (bare `<text>` has no intrinsic size in v0 — content measure is deferred).
      return h("text", { fg: fg.value, width: Math.max(1, content.length), height: 1 }, content);
    };
  },
});
