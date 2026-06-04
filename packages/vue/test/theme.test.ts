// Theme tests: the app theme seeds host color defaults and is what `useTheme()`
// returns, while `provideTheme()` restyles a subtree. Defaults are verified by
// reading the painted foreground out of the cell buffer (a plain `<text>` with
// no `fg` prop must render in the theme's foreground color).
import { describe, expect, test } from "bun:test";
import { Attr, Renderer } from "@vui-rs/core";
import {
  type Theme,
  createApp,
  darkTheme,
  defineComponent,
  h,
  parseColor,
  provideTheme,
  useTheme,
} from "../src/index.ts";
import {
  cellAttrs,
  cellFg,
  channels,
  firstGlyphFg,
} from "./helpers/read-buffer.ts";

const RED = parseColor("#ff0000")!;
const GREEN = parseColor("#00ff00")!;

describe("theme", () => {
  test("useTheme returns the default dark theme when none is provided", () => {
    let seen: Theme | undefined;
    const App = defineComponent({
      setup() {
        seen = useTheme();
        return () => h("text", {}, "x");
      },
    });
    const r = new Renderer(10, 3);
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    expect(seen).toEqual(darkTheme);
    app.unmount();
    r.free();
  });

  test("a host <text> defaults its foreground to the app theme", () => {
    const App = defineComponent({
      setup: () => () => h("text", { width: 1, height: 1 }, "A"),
    });
    const r = new Renderer(10, 3);
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    expect(firstGlyphFg(r)).toEqual(channels(darkTheme.fg));
    app.unmount();
    r.free();
  });

  test("a custom mount theme restyles host defaults and is read by useTheme", () => {
    const theme: Theme = { ...darkTheme, fg: RED };
    let seen: Theme | undefined;
    const App = defineComponent({
      setup() {
        seen = useTheme();
        return () => h("text", { width: 1, height: 1 }, "A");
      },
    });
    const r = new Renderer(10, 3);
    const app = createApp(App).mount({ renderer: r, altScreen: false, theme });
    expect(seen?.fg).toBe(RED);
    expect(firstGlyphFg(r)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    app.unmount();
    r.free();
  });

  test("provideTheme overrides the theme for descendants, preserving other tokens", () => {
    let childTheme: Theme | undefined;
    const Child = defineComponent({
      setup() {
        childTheme = useTheme();
        return () => h("text", {}, "c");
      },
    });
    const Parent = defineComponent({
      setup() {
        provideTheme({ accent: GREEN });
        return () => h("box", {}, h(Child));
      },
    });
    const r = new Renderer(10, 3);
    const app = createApp(Parent).mount({ renderer: r, altScreen: false });
    expect(childTheme?.accent).toBe(GREEN);
    expect(childTheme?.fg).toBe(darkTheme.fg); // untouched tokens carry through
    app.unmount();
    r.free();
  });

  test("explicit fg prop still wins over the theme default", () => {
    const App = defineComponent({
      setup: () => () => h("text", { fg: GREEN, width: 1, height: 1 }, "A"),
    });
    const r = new Renderer(10, 3);
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    expect(firstGlyphFg(r)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    app.unmount();
    r.free();
  });

  test("inline span styles survive native text-buffer rendering", () => {
    const App = defineComponent({
      setup: () => () =>
        h("text", { width: 6, height: 1 }, ["a", h("b", { fg: GREEN }, "b")]),
    });
    const r = new Renderer(10, 3);
    const app = createApp(App).mount({ renderer: r, altScreen: false });
    expect(cellFg(r, 0, 0)).toEqual(channels(darkTheme.fg));
    expect(cellFg(r, 1, 0)).toEqual(channels(GREEN));
    expect(cellAttrs(r, 1, 0) & Attr.BOLD).toBe(Attr.BOLD);
    app.unmount();
    r.free();
  });
});
