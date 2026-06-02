// `<VuiInput>` — a thin Vue binding over the native `Edit` node. It holds NO
// editing logic: key events (delivered by the focus manager) are forwarded to the
// `vui_edit_*` FFI, and the value is read back to drive `v-model`. Editing,
// grapheme/cursor math, and horizontal scroll all live in Rust.
//
// `v-model` is `value`/`update:value`. Visual/layout props (width, border,
// borderColor, …) fall through to the underlying `<input>` host element.
import { defineComponent, h, type PropType, shallowRef, watch } from "@vue/runtime-core";
import { EditMotion } from "@vui-rs/core";
import type { DispatchableEvent } from "../focus.ts";
import type { VuiHostNode } from "../host-node.ts";

type ColorProp = string | number;

export const VuiInput = defineComponent({
  name: "VuiInput",
  props: {
    value: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    placeholderColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    cursorColor: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    maxLength: { type: Number, default: undefined },
    /** Request focus on mount; Tab traversal takes over thereafter. */
    focused: { type: Boolean, default: false },
  },
  emits: ["update:value", "input", "change", "enter"],
  setup(props, { emit }) {
    const el = shallowRef<VuiHostNode>();
    // The value we last surfaced to the parent — guards the v-model echo: when the
    // parent writes back the same value we just emitted, we must NOT re-set it
    // (which would jump the cursor to the end on every keystroke).
    let lastEmitted = props.value;
    let lastChanged = props.value;

    function edit() {
      return el.value?.core?.edit;
    }

    // Apply initial value + focus once the host element exists. (placeholder /
    // colors / maxLength arrive as host props and are applied by patchProp.)
    watch(el, (node) => {
      if (!node?.core) return;
      node.core.edit.setValue(props.value);
      lastEmitted = lastChanged = props.value;
      if (props.focused) node.ctx.focusManager?.focus(node);
    });

    // External v-model writes: push into the buffer only when they differ from
    // what's already there (skips the echo of our own emits).
    watch(
      () => props.value,
      (v) => {
        const e = edit();
        if (!e || v === e.getValue()) return;
        e.setValue(v);
        lastEmitted = lastChanged = v;
        el.value?.ctx.scheduleRender();
      },
    );

    function surface(): string {
      const value = edit()!.getValue();
      if (value !== lastEmitted) {
        lastEmitted = value;
        emit("update:value", value);
        emit("input", value);
      }
      el.value?.ctx.scheduleRender();
      return value;
    }

    function onKeyDown(ev: DispatchableEvent): void {
      const e = edit();
      if (!e || ev.type !== "key") return;
      let handled = true;
      switch (ev.name) {
        case "left":
          e.move(ev.ctrl || ev.alt ? EditMotion.WordLeft : EditMotion.Left);
          break;
        case "right":
          e.move(ev.ctrl || ev.alt ? EditMotion.WordRight : EditMotion.Right);
          break;
        case "home":
          e.move(EditMotion.Home);
          break;
        case "end":
          e.move(EditMotion.End);
          break;
        case "backspace":
          e.backspace();
          break;
        case "delete":
          e.delete();
          break;
        case "enter": {
          const value = e.getValue();
          if (value !== lastChanged) {
            lastChanged = value;
            emit("change", value);
          }
          emit("enter", value);
          break;
        }
        default:
          if (isPrintable(ev)) e.insert(ev.name);
          else handled = false;
      }
      if (handled) {
        ev.preventDefault();
        if (ev.name !== "enter") surface();
      }
    }

    function onPaste(ev: DispatchableEvent): void {
      const e = edit();
      if (!e || ev.type !== "paste") return;
      e.insert(ev.text);
      ev.preventDefault();
      surface();
    }

    function onBlur(): void {
      const value = edit()?.getValue();
      if (value !== undefined && value !== lastChanged) {
        lastChanged = value;
        emit("change", value);
      }
    }

    return () =>
      h("input", {
        ref: el,
        focusable: true,
        placeholder: props.placeholder,
        placeholderColor: props.placeholderColor,
        cursorColor: props.cursorColor,
        maxLength: props.maxLength,
        onKeyDown,
        onPaste,
        onBlur,
      });
  },
});

/** A bare printable key (single grapheme, no ctrl/alt/meta) — text to insert. */
function isPrintable(ev: DispatchableEvent): boolean {
  return (
    ev.type === "key" &&
    !ev.ctrl &&
    !ev.alt &&
    !ev.meta &&
    ev.name >= " " &&
    [...ev.name].length === 1
  );
}
