// Toasts — non-blocking corner notifications. `provideToasts()` (call once near
// the app root) installs a reactive controller; `useToast()` reaches it from any
// descendant to `show`/`dismiss`/`clear`; `<VuiToastHost>` renders the stack in a
// non-trapping `<overlay>` corner (so it never steals focus). Each toast
// auto-dismisses after its `duration` via a timeline tween on the shared frame
// loop (no private timer), dimming toward the background in its final stretch as a
// fade — the engine usage Phase 04 set up.
import {
  type InjectionKey,
  type PropType,
  computed,
  defineComponent,
  h,
  inject,
  provide,
  reactive,
  shallowRef,
} from "@vue/runtime-core";
import { useTheme, useTimeline } from "@vui-rs/vue";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  /** Auto-dismiss after this many ms; 0 keeps it until dismissed manually. */
  duration: number;
}

export interface ToastController {
  toasts: Toast[];
  show: (message: string, opts?: { kind?: ToastKind; duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const ToastSymbol: InjectionKey<ToastController> = Symbol("vui.toasts");

/** Create + provide the toast controller. Call once in your root component setup. */
export function provideToasts(): ToastController {
  const toasts = reactive<Toast[]>([]);
  let nextId = 1;
  const controller: ToastController = {
    toasts,
    show(message, opts) {
      const id = nextId++;
      toasts.push({ id, message, kind: opts?.kind ?? "info", duration: opts?.duration ?? 4000 });
      return id;
    },
    dismiss(id) {
      const at = toasts.findIndex((t) => t.id === id);
      if (at >= 0) toasts.splice(at, 1);
    },
    clear() {
      toasts.splice(0, toasts.length);
    },
  };
  provide(ToastSymbol, controller);
  return controller;
}

/** Access the toast controller installed by `provideToasts()`. */
export function useToast(): ToastController {
  const c = inject(ToastSymbol, null);
  if (!c) throw new Error("useToast() requires provideToasts() in an ancestor");
  return c;
}

/** Linear mix of two packed 0xRRGGBBAA colors (t=0 → a, t=1 → b). */
function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | (a & 0xff)) >>> 0);
}

/** One toast row; owns its auto-dismiss tween + fade. */
const ToastItem = defineComponent({
  name: "ToastItem",
  props: { toast: { type: Object as PropType<Toast>, required: true } },
  emits: ["dismiss"],
  setup(props, { emit }) {
    const theme = useTheme();
    const timeline = useTimeline();
    // `fade` (1 → 0) drives the final-stretch dim; written from the tween's
    // onUpdate (the tween's own `.value` is not reactive — mirror it into a ref,
    // as the spinner does). duration 0 = sticky (no tween, stays at full).
    const fade = shallowRef(1);
    if (props.toast.duration > 0) {
      timeline.animate({
        from: 0,
        to: 1,
        duration: props.toast.duration,
        easing: "linear",
        onUpdate: (p) => {
          fade.value = p < 0.8 ? 1 : Math.max(0, 1 - (p - 0.8) / 0.2); // hold, then fade last 20%
        },
        onComplete: () => emit("dismiss", props.toast.id),
      });
    }

    const accent = (): number => {
      const k = props.toast.kind;
      return k === "success" ? theme.success : k === "warning" ? theme.warning : k === "error" ? theme.error : theme.info;
    };

    return () => {
      const t = fade.value;
      const bg = theme.backgroundPanel;
      return h(
        "box",
        {
          border: "rounded",
          borderColor: mix(bg, accent(), t),
          bg,
          padding: { left: 1, right: 1 },
          margin: { top: 1 },
          minWidth: 24,
          maxWidth: 48,
        },
        h("text", { fg: mix(bg, theme.text, t), wrap: "word" }, [
          h("span", { fg: mix(bg, accent(), t), bold: true }, `${ICON[props.toast.kind]} `),
          props.toast.message,
        ]),
      );
    };
  },
});

const ICON: Record<ToastKind, string> = {
  info: "ℹ",
  success: "✔",
  warning: "⚠",
  error: "✖",
};

export const VuiToastHost = defineComponent({
  name: "VuiToastHost",
  props: {
    /** Corner to stack toasts in. */
    position: {
      type: String as PropType<"top-right" | "top-left" | "bottom-right" | "bottom-left">,
      default: "top-right",
    },
  },
  setup(props) {
    const controller = useToast();
    const align = computed(() => {
      const top = props.position.startsWith("top");
      const right = props.position.endsWith("right");
      return {
        justifyContent: top ? "flex-start" : "flex-end",
        alignItems: right ? "flex-end" : "flex-start",
      } as const;
    });
    return () =>
      h(
        "overlay",
        {
          trapFocus: false,
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          flexDirection: "column",
          justifyContent: align.value.justifyContent,
          alignItems: align.value.alignItems,
        },
        controller.toasts.map((toast) =>
          h(ToastItem, { key: toast.id, toast, onDismiss: (id: number) => controller.dismiss(id) }),
        ),
      );
  },
});
