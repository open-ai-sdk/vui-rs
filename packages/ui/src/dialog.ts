// `VuiDialog` — the base modal every other dialog builds on. It renders an
// `<overlay>` (Phase 01: top layer, hoisted layout) with an opaque dim backdrop
// and a centered, bordered, theme-coloured panel. The overlay carries
// `trapFocus`, so while it is open Tab/Shift-Tab cycle only inside it (see
// `focus.ts`), and `useFocusTrap` restores the prior focus on close. Esc emits
// close (cancellable via `closeOnEsc`). The panel body is the default slot; an
// optional `title` slot overrides the titled border. Size is a small set of
// presets (`medium`/`large`/`xlarge`) mapped to width/max-height, matching the
// opencode dialog sizes.
import { type PropType, computed, defineComponent, h } from "@vue/runtime-core";
import { type DispatchableEvent, useTheme } from "@vui-rs/vue";
import { useFocusTrap } from "./use-focus-trap.ts";

export type DialogSize = "small" | "medium" | "large" | "xlarge";

/** Preset panel widths (columns). Height grows to content, capped by the overlay. */
const SIZE_WIDTH: Record<DialogSize, number> = {
  small: 40,
  medium: 56,
  large: 76,
  xlarge: 100,
};

export const VuiDialog = defineComponent({
  name: "VuiDialog",
  inheritAttrs: false,
  props: {
    /** v-model: whether the dialog is open. */
    open: { type: Boolean, default: false },
    title: { type: String, default: "" },
    size: { type: String as PropType<DialogSize>, default: "medium" },
    /** Backdrop dim strength (0..1 brightness multiplier); `false` for none. */
    backdrop: { type: [Number, Boolean] as PropType<number | boolean>, default: 0.4 },
    /** Esc closes the dialog (emits `update:open=false` + `close`). */
    closeOnEsc: { type: Boolean, default: true },
    /**
     * Auto-focus the panel itself on open. Default `true` for plain content
     * dialogs (so they receive Esc). Variants with their own focusable control
     * (select, input, buttons) pass `false` and focus that control instead; Esc
     * still bubbles up to the panel's handler from the focused child.
     */
    autofocus: { type: Boolean, default: true },
    /** Override the panel width (columns); defaults to the `size` preset. */
    width: { type: Number, default: undefined },
  },
  emits: ["update:open", "close"],
  setup(props, { slots, emit, attrs }) {
    const theme = useTheme();
    useFocusTrap(() => props.open);

    const width = computed(() => props.width ?? SIZE_WIDTH[props.size]);

    function close(): void {
      emit("update:open", false);
      emit("close");
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== "key") return;
      if (props.closeOnEsc && ev.name === "escape") {
        ev.preventDefault();
        close();
      }
      // Other keys fall through to the consumer's @keyDown on the panel.
      (attrs.onKeyDown as ((ev: DispatchableEvent) => void) | undefined)?.(ev);
    }

    return () => {
      if (!props.open) return null;
      return h(
        "overlay",
        {
          trapFocus: true,
          backdrop: props.backdrop,
          alignItems: "center",
          justifyContent: "center",
        },
        h(
          "box",
          {
            ...attrs,
            width: width.value,
            maxHeight: { pct: 0.9 },
            flexDirection: "column",
            border: "rounded",
            borderColor: theme.borderActive,
            bg: theme.backgroundPanel,
            fg: theme.text,
            padding: { left: 2, right: 2, top: 1, bottom: 1 },
            title: props.title ? ` ${props.title} ` : undefined,
            focusable: props.autofocus,
            focused: props.autofocus,
            onKeyDown,
          },
          slots.default?.(),
        ),
      );
    };
  },
});
