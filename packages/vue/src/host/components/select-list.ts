import {
  type PropType,
  computed,
  defineComponent,
  h,
  ref,
  watch,
} from "@vue/runtime-core";
import type { DispatchableEvent, DispatchableMouseEvent } from "../focus.ts";

type ColorProp = string | number;
export type SelectItemValue = string | number;
export type SelectItem =
  | SelectItemValue
  | {
      label: string;
      value: SelectItemValue;
      disabled?: boolean;
    };

function labelOf(item: SelectItem): string {
  return typeof item === "object" ? item.label : String(item);
}

function valueOf(item: SelectItem): SelectItemValue {
  return typeof item === "object" ? item.value : item;
}

function disabledOf(item: SelectItem): boolean {
  return typeof item === "object" && item.disabled === true;
}

export const VuiSelectList = defineComponent({
  name: "VuiSelectList",
  inheritAttrs: false,
  props: {
    items: { type: Array as PropType<SelectItem[]>, required: true },
    modelValue: { type: [String, Number] as PropType<SelectItemValue | undefined>, default: undefined },
    focused: { type: Boolean, default: false },
    focusable: { type: Boolean, default: true },
    activeBg: { type: [String, Number] as PropType<ColorProp>, default: "blue" },
    activeFg: { type: [String, Number] as PropType<ColorProp>, default: "white" },
    selectedBg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
    selectedFg: { type: [String, Number] as PropType<ColorProp>, default: undefined },
  },
  emits: ["update:modelValue", "select", "active"],
  setup(props, { attrs, emit }) {
    const selectedIndex = computed(() => props.items.findIndex((item) => valueOf(item) === props.modelValue));
    const activeIndex = ref(Math.max(0, selectedIndex.value));

    function firstEnabled(start = 0, step: 1 | -1 = 1): number {
      if (props.items.length === 0) return -1;
      let i = Math.max(0, Math.min(props.items.length - 1, start));
      for (let seen = 0; seen < props.items.length; seen += 1) {
        if (!disabledOf(props.items[i]!)) return i;
        i = (i + step + props.items.length) % props.items.length;
      }
      return -1;
    }

    function setActive(index: number): void {
      const next = firstEnabled(index, index < activeIndex.value ? -1 : 1);
      if (next < 0) return;
      activeIndex.value = next;
      emit("active", next);
    }

    function select(index = activeIndex.value): void {
      const item = props.items[index];
      if (!item || disabledOf(item)) return;
      const value = valueOf(item);
      activeIndex.value = index;
      emit("update:modelValue", value);
      emit("select", value, item, index);
    }

    function move(delta: number): void {
      if (props.items.length === 0) return;
      let next = activeIndex.value;
      for (let seen = 0; seen < props.items.length; seen += 1) {
        next = (next + delta + props.items.length) % props.items.length;
        if (!disabledOf(props.items[next]!)) {
          setActive(next);
          return;
        }
      }
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== "key") return;
      switch (ev.name) {
        case "up":
          ev.preventDefault();
          move(-1);
          break;
        case "down":
          ev.preventDefault();
          move(1);
          break;
        case "home":
          ev.preventDefault();
          setActive(0);
          break;
        case "end":
          ev.preventDefault();
          setActive(props.items.length - 1);
          break;
        case "enter":
        case "space":
          ev.preventDefault();
          select();
          break;
      }
    }

    function onRowMouseDown(index: number) {
      return (ev: DispatchableMouseEvent): void => {
        if (ev.type !== "mouse" || ev.button !== "left") return;
        ev.preventDefault();
        select(index);
      };
    }

    watch(selectedIndex, (index) => {
      if (index >= 0) activeIndex.value = index;
    });

    watch(
      () => props.items,
      () => {
        if (activeIndex.value >= props.items.length || disabledOf(props.items[activeIndex.value]!)) {
          setActive(Math.min(activeIndex.value, props.items.length - 1));
        }
      },
    );

    return () =>
      h(
        "box",
        {
          ...attrs,
          focusable: props.focusable,
          focused: props.focused,
          flexDirection: "column",
          onKeyDown,
        },
        props.items.map((item, index) => {
          const active = index === activeIndex.value;
          const selected = index === selectedIndex.value;
          return h(
            "text",
            {
              key: String(valueOf(item)),
              width: { pct: 1 },
              bg: active ? props.activeBg : selected ? props.selectedBg : undefined,
              fg: active ? props.activeFg : selected ? props.selectedFg : undefined,
              dim: disabledOf(item),
              onMouseDown: onRowMouseDown(index),
            },
            labelOf(item),
          );
        }),
      );
  },
});

export const VuiSelect = VuiSelectList;

