// `<VuiSpinner>` — a small animated busy indicator, built entirely from the
// built-in `text` element + a timer. It demonstrates the intended extensibility
// path: custom widgets are plain Vue components composing existing kinds, needing
// no Rust/core change. Color defaults to the theme accent and can be overridden;
// the frame cycles on an interval while mounted and stops cleanly on unmount.
import {
  type PropType,
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  shallowRef,
} from "@vue/runtime-core";
import { parseColor } from "@vui-rs/core";
import { useTheme } from "../use-theme.ts";

type ColorProp = string | number;

/** Default braille spinner frames. */
const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const VuiSpinner = defineComponent({
  name: "VuiSpinner",
  props: {
    /** Animation frames, cycled in order. */
    frames: { type: Array as PropType<string[]>, default: () => DEFAULT_FRAMES },
    /** Milliseconds between frames. */
    interval: { type: Number, default: 80 },
    /** Spinner color; defaults to the active theme's accent. */
    color: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    /** Optional label rendered after the spinner glyph. */
    label: { type: String, default: "" },
  },
  setup(props) {
    const theme = useTheme();
    const index = shallowRef(0);
    const fg = computed(() => props.color != null ? parseColor(props.color) : theme.accent);
    let timer: ReturnType<typeof setInterval> | undefined;

    onMounted(() => {
      timer = setInterval(() => {
        // Guard against an empty frames array (would divide by zero → NaN index).
        const n = props.frames.length;
        if (n > 0) index.value = (index.value + 1) % n;
      }, Math.max(1, props.interval));
    });
    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    });

    return () => {
      const glyph = props.frames[index.value % (props.frames.length || 1)] ?? "";
      const content = props.label ? `${glyph} ${props.label}` : glyph;
      // Self-size to one row of the content so the spinner renders standalone
      // (bare `<text>` has no intrinsic size in v0 — content measure is deferred).
      return h("text", { fg: fg.value, width: Math.max(1, content.length), height: 1 }, content);
    };
  },
});
