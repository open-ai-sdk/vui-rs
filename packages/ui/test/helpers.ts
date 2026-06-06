// Shared test harness for @vui-rs/ui components: mount a render fn into an
// offscreen renderer through the real host app (so focus, overlays, layout, paint,
// and the animation scheduler all run), feed it key/mouse events the way the
// terminal session would, and read the painted cell buffer back.
import { type KeyEvent, type MouseEvent, Renderer } from "@vui-rs/core";
import { createHostApp, defineComponent, nextTick } from "@vui-rs/vue";

export { allGlyphs, rowGlyphs, cellBg, cellFg, channels } from "../../vue/test/helpers/read-buffer.ts";

export function key(name: string, mods: Partial<KeyEvent> = {}): KeyEvent {
  // Shaped as a DispatchableEvent (preventDefault/defaultPrevented) so handlers
  // called directly in a test behave as they would when bubbled by the focus
  // manager (which re-augments the same object on dispatch — harmless overwrite).
  return {
    type: "key",
    name,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    raw: name,
    defaultPrevented: false,
    preventDefault() {},
    ...mods,
  } as KeyEvent;
}

export function mouseDown(x: number, y: number): MouseEvent {
  return { type: "mouse", kind: "down", button: "left", x, y, ctrl: false, alt: false, shift: false, meta: false, raw: "" };
}

export function mount(w: number, h: number, render: () => unknown) {
  const r = new Renderer(w, h);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return {
    app,
    ctx: app.context,
    renderer: r,
    /** Dispatch an input event through the focus manager, then settle a frame. */
    dispatch(ev: KeyEvent | MouseEvent): void {
      app.context.focusManager!.dispatch(ev);
      app.context.flushNow();
    },
    flush(): void {
      app.context.flushNow();
    },
    /** Let Vue's reactive re-render run, then paint — so the buffer reflects state changes. */
    async settle(): Promise<void> {
      await nextTick();
      app.context.flushNow();
    },
    cleanup(): void {
      app.unmount();
      r.free();
    },
  };
}
