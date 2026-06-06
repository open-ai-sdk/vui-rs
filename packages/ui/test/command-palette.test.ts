import { describe, expect, test } from "bun:test";
import { h, nextTick, ref } from "@vue/runtime-core";
import { type Command, VuiCommandPalette } from "../src/command-palette.ts";
import { key, mount } from "./helpers.ts";

function mountPalette() {
  const open = ref(true);
  const ran: string[] = [];
  const commands: Command[] = [
    { id: "build", title: "Build project", run: () => ran.push("build") },
    { id: "test", title: "Run tests", run: () => ran.push("test") },
  ];
  const runEvents: Command[] = [];
  const harness = mount(60, 14, () =>
    h(VuiCommandPalette, {
      open: open.value,
      commands,
      "onUpdate:open": (v: boolean) => (open.value = v),
      onRun: (c: Command) => runEvents.push(c),
    }),
  );
  return { ...harness, ran, runEvents, open };
}

describe("VuiCommandPalette", () => {
  test("Enter dispatches the active command's run() and emits run", async () => {
    const { dispatch, ran, runEvents, open, cleanup } = mountPalette();
    await nextTick();
    dispatch(key("enter")); // active 0 = Build project
    expect(ran).toEqual(["build"]);
    expect(runEvents.map((c) => c.id)).toEqual(["build"]);
    expect(open.value).toBe(false);
    cleanup();
  });

  test("fuzzy search then Enter dispatches the match", async () => {
    const { dispatch, ran, cleanup } = mountPalette();
    await nextTick();
    dispatch(key("t"));
    dispatch(key("e"));
    dispatch(key("s"));
    dispatch(key("t")); // "test" → Run tests
    dispatch(key("enter"));
    expect(ran).toEqual(["test"]);
    cleanup();
  });
});
