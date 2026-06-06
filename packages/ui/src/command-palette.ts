// `VuiCommandPalette` — the Ctrl/Cmd-K command launcher. It is a thin specialise
// of `VuiDialogSelect`: commands map to fuzzy-searchable rows (title + keybind
// hint + optional group), and selecting one runs its `run()` and emits `run`.
//
// Opening is the app's job: the palette has no global key listener (only the
// focused node sees keys in this model), so bind Ctrl-K in your root handler to
// toggle the `open` v-model. Once open, the dialog owns the keyboard (search,
// navigate, Enter to dispatch, Esc to close).
import { type PropType, computed, defineComponent, h } from "@vue/runtime-core";
import { VuiDialogSelect } from "./dialog-select.ts";

export interface Command {
  id: string;
  title: string;
  /** Right-aligned hint, typically the keybinding (e.g. "⌘S"). */
  hint?: string;
  /** Optional group header (shown when not searching). */
  group?: string;
  /** Invoked when the command is chosen. */
  run?: () => void;
}

export const VuiCommandPalette = defineComponent({
  name: "VuiCommandPalette",
  props: {
    open: { type: Boolean, default: false },
    commands: { type: Array as PropType<Command[]>, default: () => [] },
    title: { type: String, default: "Commands" },
    placeholder: { type: String, default: "Type a command…" },
  },
  emits: ["update:open", "run", "close"],
  setup(props, { emit }) {
    const items = computed(() =>
      props.commands.map((c) => ({ label: c.title, value: c.id, group: c.group, hint: c.hint })),
    );

    function onSelect(id: string | number): void {
      const cmd = props.commands.find((c) => c.id === id);
      if (!cmd) return;
      cmd.run?.();
      emit("run", cmd);
    }

    return () =>
      h(VuiDialogSelect, {
        open: props.open,
        title: props.title,
        placeholder: props.placeholder,
        items: items.value,
        "onUpdate:open": (v: boolean) => emit("update:open", v),
        onSelect,
        onClose: () => emit("close"),
      });
  },
});
