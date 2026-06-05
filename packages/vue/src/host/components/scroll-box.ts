import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
} from "@vue/runtime-core";
import type { DispatchableEvent, DispatchableMouseEvent } from "../focus.ts";
import type { Renderable } from "../renderable.ts";
import { VuiScrollBar } from "./scroll-bar.ts";

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

interface ViewState {
  y: number;
  viewportHeight: number;
  contentHeight: number;
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
    /**
     * Chat/transcript mode: keep the view pinned to the bottom as content grows,
     * unless the user has scrolled up. Uncontrolled only — don't bind modelValue.
     */
    stickToBottom: { type: Boolean, default: false },
    /** Render an integrated vertical scrollbar (indicator + drag) on the right edge. */
    scrollbar: { type: Boolean, default: false },
  },
  emits: ["update:modelValue", "update:scrollY", "scroll"],
  setup(props, { attrs, emit, slots }) {
    const viewport = shallowRef<Renderable>();
    let localScrollY = 0;
    // Whether the view is pinned to the bottom (stickToBottom). Flipped off when
    // the user scrolls away from the bottom, back on when they return to it.
    let stuck = props.stickToBottom;
    // Reactive geometry the integrated scrollbar renders from; refreshed whenever
    // the scroll offset or content size changes (incl. stick-to-bottom in
    // afterLayout), so the thumb follows even when nothing else re-renders.
    const view = shallowRef<ViewState>({ y: 0, viewportHeight: 0, contentHeight: 0 });

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

    function current(): number {
      return clamp(currentProp() ?? localScrollY, maxScroll());
    }

    // Recompute the scrollbar geometry from the latest rects; only writes (and so
    // re-renders) when something changed.
    function refreshView(): void {
      if (!props.scrollbar) return;
      const viewportHeight = rectContentHeight(viewport.value);
      const contentHeight = viewportHeight + maxScroll();
      const y = current();
      const v = view.value;
      if (v.y !== y || v.viewportHeight !== viewportHeight || v.contentHeight !== contentHeight) {
        view.value = { y, viewportHeight, contentHeight };
      }
    }

    function apply(value: number): void {
      const max = maxScroll();
      const next = clamp(value, max);
      localScrollY = next;
      // At (or below) the last row → re-pin; scrolled up → release the pin.
      if (props.stickToBottom) stuck = next >= max;
      if (viewport.value) {
        viewport.value.scrollY = next;
        viewport.value.markDirty();
      }
      emit("update:modelValue", next);
      emit("update:scrollY", next);
      emit("scroll", next);
      refreshView();
      viewport.value?.ctx.scheduleRender();
    }

    function scrollBy(delta: number): void {
      apply(current() + delta);
    }

    // After layout (rects fresh), pin to the new bottom when stuck, or re-clamp a
    // stale offset when content shrank/resized. Uncontrolled only — a bound
    // scrollY/modelValue owns the offset, so leave it alone. No scheduleRender:
    // paint runs immediately after this in the same frame.
    function syncScroll(): void {
      const vp = viewport.value;
      if (!vp || currentProp() !== undefined) {
        refreshView();
        return;
      }
      const max = maxScroll();
      const target = props.stickToBottom && stuck ? max : clamp(localScrollY, max);
      if (vp.scrollY !== target || localScrollY !== target) {
        localScrollY = target;
        vp.scrollY = target;
        vp.markDirty();
      }
      refreshView();
    }

    function onKeyDown(ev: DispatchableEvent): void {
      if (ev.type === "key") {
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
        if (delta !== undefined) {
          ev.preventDefault();
          scrollBy(delta);
          return;
        }
      }
      // Not a scroll key: forward to the consumer's @keyDown (the component box
      // owns onKeyDown, so without this the consumer handler would be swallowed).
      (attrs.onKeyDown as ((ev: DispatchableEvent) => void) | undefined)?.(ev);
    }

    function onWheel(ev: DispatchableMouseEvent): void {
      if (ev.type === "mouse" && ev.kind === "wheel") {
        ev.preventDefault();
        scrollBy(ev.button === "wheelUp" ? -props.step : props.step);
        return;
      }
      (attrs.onWheel as ((ev: DispatchableMouseEvent) => void) | undefined)?.(ev);
    }

    watch(
      () => currentProp(),
      (value) => {
        if (value !== undefined) apply(value);
      },
    );

    onMounted(() => {
      // The template ref binds during the patch, not synchronously in onMounted on
      // this host renderer — defer to the next tick so `viewport.value` exists.
      void nextTick(() => {
        viewport.value?.ctx.afterLayout.add(syncScroll);
        if (props.stickToBottom) {
          stuck = true;
          syncScroll(); // pin to the bottom on first layout
          viewport.value?.ctx.scheduleRender();
        } else {
          apply(current());
        }
      });
    });

    onUnmounted(() => {
      viewport.value?.ctx.afterLayout.delete(syncScroll);
    });

    return () => {
      const y = current();
      // The scrolling viewport: clips + culls its children (boxes default to
      // overflow `visible`, so the scroll-box opts into clipping).
      if (!props.scrollbar) {
        return h(
          "box",
          {
            flexDirection: "column",
            alignItems: "stretch",
            ...attrs,
            ref: viewport,
            overflow: "scroll",
            focusable: props.focusable,
            focused: props.focused,
            scrollY: y,
            onKeyDown,
            onWheel,
          },
          slots.default?.(),
        );
      }
      // Integrated scrollbar: the OUTER row owns the layout attrs (size/border/
      // padding) so the frame wraps content + bar; the inner viewport flex-grows
      // into the remaining width and keeps the scroll behaviour + focus.
      const content = h(
        "box",
        {
          flexDirection: "column",
          alignItems: "stretch",
          flexGrow: 1,
          ref: viewport,
          overflow: "scroll",
          focusable: props.focusable,
          focused: props.focused,
          scrollY: y,
          onKeyDown,
          onWheel,
        },
        slots.default?.(),
      );
      const v = view.value;
      return h("box", { flexDirection: "row", alignItems: "stretch", ...attrs }, [
        content,
        h(VuiScrollBar, {
          scrollY: v.y,
          viewportHeight: v.viewportHeight,
          contentHeight: v.contentHeight,
          "onUpdate:scrollY": (next: number) => apply(next),
        }),
      ]);
    };
  },
});
