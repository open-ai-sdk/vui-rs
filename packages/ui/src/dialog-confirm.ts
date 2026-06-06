// `VuiDialogConfirm` — a yes/no decision modal. Title + message + two choices
// rendered inline; Left/Right or Tab move the highlight, Enter commits the
// highlighted choice, `y`/`n` are shortcuts, and Esc cancels. Emits `confirm`
// (true/false) plus the v-model `update:open`. The panel is auto-focused and owns
// all keys (no separate focusable buttons — keeps focus simple and predictable).
import { defineComponent, h, ref, watch } from "@vue/runtime-core";
import { type DispatchableEvent, useTheme } from "@vui-rs/vue";
import { VuiDialog } from "./dialog.ts";

export const VuiDialogConfirm = defineComponent({
  name: "VuiDialogConfirm",
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: "Confirm" },
    message: { type: String, default: "Are you sure?" },
    confirmLabel: { type: String, default: "Yes" },
    cancelLabel: { type: String, default: "No" },
    /** Which choice is highlighted when the dialog opens. */
    defaultConfirm: { type: Boolean, default: true },
  },
  emits: ["update:open", "confirm", "close"],
  setup(props, { emit }) {
    const theme = useTheme();
    const confirmActive = ref(props.defaultConfirm);

    // Reset the highlight to the default each time the dialog reopens.
    watch(
      () => props.open,
      (open) => {
        if (open) confirmActive.value = props.defaultConfirm;
      },
    );

    function decide(value: boolean): void {
      emit("confirm", value);
      emit("update:open", false);
      emit("close");
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== "key") return;
      switch (ev.name) {
        case "left":
        case "right":
        case "tab":
          ev.preventDefault();
          confirmActive.value = !confirmActive.value;
          break;
        case "y":
          ev.preventDefault();
          decide(true);
          break;
        case "n":
          ev.preventDefault();
          decide(false);
          break;
        case "enter":
          ev.preventDefault();
          decide(confirmActive.value);
          break;
      }
    }

    function choice(label: string, active: boolean) {
      return h(
        "text",
        {
          bg: active ? theme.primary : theme.backgroundElement,
          fg: active ? theme.selectedText : theme.text,
          padding: { left: 2, right: 2 },
        },
        label,
      );
    }

    return () =>
      h(
        VuiDialog,
        {
          open: props.open,
          title: props.title,
          size: "small",
          "onUpdate:open": (v: boolean) => emit("update:open", v),
          onClose: () => emit("close"),
          onKeyDown,
        },
        () => [
          h("text", { fg: theme.text, wrap: "word" }, props.message),
          h("text", {}, " "),
          h("box", { flexDirection: "row", gap: 2, justifyContent: "flex-end" }, [
            choice(props.confirmLabel, confirmActive.value),
            choice(props.cancelLabel, !confirmActive.value),
          ]),
        ],
      );
  },
});
