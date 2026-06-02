// The theme: a small set of semantic color tokens (packed `0xRRGGBBAA`) that
// drive default colors across the tree. The app-level theme is applied to host
// `<box>`/`<text>` defaults at mount (canvas fg/bg, text fg, default border
// color); components read the active theme with `useTheme()` and can restyle a
// subtree with `provideTheme()`. Tokens are resolved colors — author them with
// `parseColor`-friendly strings and they are packed once here.
import type { InjectionKey } from "@vue/runtime-core";
import { parseColor } from "@vui-rs/core";

/** Semantic color tokens. Values are packed `0xRRGGBBAA` numbers. */
export interface Theme {
  /** Default foreground (text). */
  fg: number;
  /** Canvas background. */
  bg: number;
  /** Primary accent (highlights, spinners, focused affordances). */
  accent: number;
  /** De-emphasised text (hints, secondary labels). */
  muted: number;
  /** Default border color. */
  border: number;
  /** Error / destructive color. */
  error: number;
}

/** Injection key for the active theme; `useTheme()` reads it, `provideTheme()` sets it. */
export const ThemeSymbol: InjectionKey<Theme> = Symbol("vui.theme");

function packed(color: string): number {
  return parseColor(color)!;
}

/** The default dark theme (Catppuccin Mocha palette). */
export const darkTheme: Theme = {
  fg: packed("#cdd6f4"),
  bg: packed("#1e1e2e"),
  accent: packed("#89b4fa"),
  muted: packed("#7f849c"),
  border: packed("#585b70"),
  error: packed("#f38ba8"),
};
