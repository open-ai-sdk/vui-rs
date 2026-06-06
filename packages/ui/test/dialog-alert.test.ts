import { describe, expect, test } from "bun:test";
import { h, nextTick, ref } from "@vue/runtime-core";
import { VuiDialogAlert } from "../src/dialog-alert.ts";
import { allGlyphs, key, mount } from "./helpers.ts";

function mountAlert() {
  const open = ref(true);
  const closed: number[] = [];
  const harness = mount(60, 12, () =>
    h(VuiDialogAlert, {
      open: open.value,
      title: "Heads up",
      message: "Something happened",
      "onUpdate:open": (v: boolean) => (open.value = v),
      onClose: () => closed.push(1),
    }),
  );
  return { ...harness, closed, open };
}

describe("VuiDialogAlert", () => {
  test("renders the message", async () => {
    const { renderer, flush, cleanup } = mountAlert();
    await nextTick();
    flush();
    expect(allGlyphs(renderer)).toContain("Something");
    cleanup();
  });

  for (const k of ["enter", "space", "escape"]) {
    test(`${k} dismisses the alert`, async () => {
      const { dispatch, closed, open, cleanup } = mountAlert();
      await nextTick();
      dispatch(key(k));
      expect(open.value).toBe(false);
      expect(closed).toEqual([1]);
      cleanup();
    });
  }
});
