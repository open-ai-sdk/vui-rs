// Theme composables. `useTheme()` reads the active theme from Vue's
// provide/inject — the app-level theme by default (set at mount), or a closer
// `provideTheme()` override. `provideTheme()` merges a partial palette over the
// current theme and provides it to the calling component's subtree, so a panel
// can restyle just its descendants without touching the rest of the tree.
import { inject, provide } from "@vue/runtime-core";
import { type Theme, ThemeSymbol, darkTheme } from "./theme.ts";

/** The active theme for the current component (app theme, or a subtree override). */
export function useTheme(): Theme {
  return inject(ThemeSymbol, darkTheme);
}

/** Override the theme for this component's subtree; merges over the active theme. */
export function provideTheme(theme: Partial<Theme>): Theme {
  const merged: Theme = { ...inject(ThemeSymbol, darkTheme), ...theme };
  provide(ThemeSymbol, merged);
  return merged;
}
