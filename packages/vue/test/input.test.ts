// `<VuiInput>` drives v-model by forwarding parsed key events to the native edit
// buffer and reading the value back. Runs offscreen: a renderer is injected, and
// key events are fed through the focus manager exactly as the real input pump does.
import { describe, expect, test } from "bun:test";
import { Renderer, parseKeys } from "@vui-rs/core";
import { createApp, defineComponent, h, nextTick, ref, VuiInput } from "../src/index.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function mountInput(extra: Record<string, unknown> = {}) {
  const r = new Renderer(20, 3);
  const model = ref("");
  const App = defineComponent({
    setup:
      () =>
      () =>
        h(VuiInput, {
          width: { pct: 1 },
          height: 1,
          focused: true,
          value: model.value,
          "onUpdate:value": (v: string) => {
            model.value = v;
          },
          ...extra,
        }),
  });
  const app = createApp(App).mount({ renderer: r, altScreen: false });
  await nextTick();
  await sleep(10); // let the el-watch apply initial value + focus
  const type = (data: string) => {
    for (const ev of parseKeys(data)) app.context.focusManager!.dispatch(ev);
  };
  return {
    app,
    model,
    type,
    cleanup: () => {
      app.unmount();
      r.free();
    },
  };
}

describe("VuiInput", () => {
  test("typing updates v-model", async () => {
    const { model, type, cleanup } = await mountInput();
    try {
      expect(model.value).toBe("");
      type("hi");
      expect(model.value).toBe("hi");
    } finally {
      cleanup();
    }
  });

  test("backspace and cursor motion edit in place", async () => {
    const { model, type, cleanup } = await mountInput();
    try {
      type("abc");
      type("\x7f"); // backspace -> "ab"
      expect(model.value).toBe("ab");
      type("\x1b[D"); // left, cursor between a|b
      type("X"); // insert at cursor -> "aXb"
      expect(model.value).toBe("aXb");
    } finally {
      cleanup();
    }
  });

  test("bracketed paste inserts literal text", async () => {
    const { model, type, cleanup } = await mountInput();
    try {
      type("\x1b[200~hello\x1b[201~");
      expect(model.value).toBe("hello");
    } finally {
      cleanup();
    }
  });

  test("maxLength clamps input", async () => {
    const { model, type, cleanup } = await mountInput({ maxLength: 3 });
    try {
      type("abcdef");
      expect(model.value).toBe("abc");
    } finally {
      cleanup();
    }
  });

  test("enter emits the enter event with the current value", async () => {
    const r = new Renderer(20, 3);
    const model = ref("");
    let submitted: string | null = null;
    const App = defineComponent({
      setup:
        () =>
        () =>
          h(VuiInput, {
            width: { pct: 1 },
            height: 1,
            focused: true,
            value: model.value,
            "onUpdate:value": (v: string) => {
              model.value = v;
            },
            onEnter: (v: string) => {
              submitted = v;
            },
          }),
    });
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    try {
      await nextTick();
      await sleep(10);
      const type = (data: string) => {
        for (const ev of parseKeys(data)) app.context.focusManager!.dispatch(ev);
      };
      type("ok\r");
      expect(submitted).toBe("ok");
    } finally {
      app.unmount();
      r.free();
    }
  });
});
