import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  shallowRef,
  watch,
} from "@vue/runtime-core";
import type { DispatchableEvent, DispatchableMouseEvent } from "../focus.ts";
import type { Renderable } from "../renderable.ts";

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, Math.floor(max))));
}

function rectContentHeight(node: Renderable | undefined): number {
  const rect = node?.rect;
  if (!rect) return 0;
  return Math.max(
    0,
    Math.round(rect.h - rect.border.top - rect.border.bottom - rect.padding.top - rect.padding.bottom),
  );
}

function laidOutHeight(node: Renderable | undefined): number {
  const rect = node?.rect;
  if (!node || !rect) return 0;
  let h = Math.round(rect.h);
  for (const child of node.children) {
    if (!child.rect) continue;
    h = Math.max(h, Math.round(child.rect.y + laidOutHeight(child)));
  }
  return h;
}

export const VuiScrollBox = defineComponent({
  name: "VuiScrollBox",
  inheritAttrs: false,
  props: {
    modelValue: { type: Number, default: undefined },
    scrollY: { type: Number, default: undefined },
    step: { type: Number, default: 1 },
    pageStep: { type: Number, default: undefined },
    focused: { type: Boolean, default: false },
    focusable: { type: Boolean, default: true },
  },
  emits: ["update:modelValue", "update:scrollY", "scroll"],
  setup(props, { attrs, emit, slots }) {
    const viewport = shallowRef<Renderable>();
    let localScrollY = 0;

    const currentProp = (): number | undefined => props.scrollY ?? props.modelValue;

    function maxScroll(): number {
      let contentHeight = rectContentHeight(viewport.value);
      for (const child of viewport.value?.children ?? []) {
        if (!child.rect) continue;
        contentHeight = Math.max(
          contentHeight,
          Math.round(child.rect.y + laidOutHeight(child)),
        );
      }
      return Math.max(0, Math.round(contentHeight - rectContentHeight(viewport.value)));
    }

    function apply(value: number): void {
      const next = clamp(value, maxScroll());
      localScrollY = next;
      if (viewport.value) {
        viewport.value.scrollY = next;
        viewport.value.markDirty();
      }
      emit("update:modelValue", next);
      emit("update:scrollY", next);
      emit("scroll", next);
      viewport.value?.ctx.scheduleRender();
    }

    function current(): number {
      return clamp(currentProp() ?? localScrollY, maxScroll());
    }

    function scrollBy(delta: number): void {
      apply(current() + delta);
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type !== "key") return;
      const page = props.pageStep ?? Math.max(1, rectContentHeight(viewport.value) - 1);
      const step = Math.max(1, Math.floor(props.step));
      const keys: Record<string, number> = {
        up: -step,
        down: step,
        pageUp: -page,
        pageDown: page,
        home: -current(),
        end: maxScroll() - current(),
      };
      const delta = keys[ev.name];
      if (delta === undefined) return;
      ev.preventDefault();
      scrollBy(delta);
    }

    function onWheel(ev: DispatchableMouseEvent): void {
      if (ev.type !== "mouse" || ev.kind !== "wheel") return;
      ev.preventDefault();
      scrollBy(ev.button === "wheelUp" ? -props.step : props.step);
    }

    watch(
      () => currentProp(),
      (value) => {
        if (value !== undefined) apply(value);
      },
    );

    onMounted(() => {
      void nextTick(() => apply(current()));
    });

    return () => {
      const y = current();
      return h(
        "box",
        {
          flexDirection: "column",
          alignItems: "stretch",
          ...attrs,
          ref: viewport,
          focusable: props.focusable,
          focused: props.focused,
          scrollY: y,
          onKeyDown,
          onWheel,
        },
        slots.default?.(),
      );
    };
  },
});
