import { describe, expect, test } from "bun:test";
import { Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { VuiSelectList } from "../src/host/components/select-list.ts";
import { defineComponent, h, nextTick, ref } from "../src/index.ts";
import { cellFg } from "./helpers/read-buffer.ts";

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt);
  const App = defineComponent({ setup: () => render });
  const app = createHostApp(App).mount({ renderer: r });
  return {
    app,
    renderer: r,
    cleanup: () => {
      app.unmount();
      r.free();
    },
  };
}

describe("select-list", () => {
  test("arrows move active item and enter updates modelValue", async () => {
    const value = ref<string | number>("one");
    const selected: Array<string | number> = [];
    const { app, renderer, cleanup } = mount(16, 6, () =>
      h(VuiSelectList, {
        width: 10,
        focused: true,
        items: ["one", "two", "three"],
        modelValue: value.value,
        activeFg: "red",
        "onUpdate:modelValue": (next: string | number) => {
          value.value = next;
        },
        onSelect: (next: string | number) => selected.push(next),
      }),
    );
    await nextTick();
    app.context.flushNow();

    app.context.focusManager!.dispatch({
      type: "key",
      name: "down",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: "",
    });
    app.context.focusManager!.dispatch({
      type: "key",
      name: "enter",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: "",
    });
    await nextTick();
    app.context.flushNow();

    expect(value.value).toBe("two");
    expect(selected).toEqual(["two"]);
    expect(cellFg(renderer, 0, 1).r).toBe(255);
    cleanup();
  });

  test("mouse down on a row selects it", async () => {
    const value = ref<string | number>("one");
    const { app, cleanup } = mount(16, 6, () =>
      h(VuiSelectList, {
        width: 10,
        items: ["one", "two", "three"],
        modelValue: value.value,
        "onUpdate:modelValue": (next: string | number) => {
          value.value = next;
        },
      }),
    );
    await nextTick();
    app.context.flushNow();

    app.context.focusManager!.dispatch({
      type: "mouse",
      kind: "down",
      button: "left",
      x: 0,
      y: 2,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      raw: "",
    });
    await nextTick();
    app.context.flushNow();

    expect(value.value).toBe("three");
    cleanup();
  });
});

