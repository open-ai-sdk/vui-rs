// Theme composables. `useTheme()` reads the active theme from Vue's
// provide/inject — the app-level theme (reactive, set at mount) by default, or a
// closer `provideTheme()` override. Because the app theme is reactive, a component
// that reads tokens in its render re-renders when `setTheme()`/`useSetTheme()` swaps
// it. `provideTheme()` merges a partial palette over the current theme for the
// calling component's subtree (a static override — it does not track later swaps).
import { inject, provide } from '@vue/runtime-core'
import { type Theme, ThemeSymbol, darkTheme } from './theme.ts'
import { HostContextSymbol } from './host/renderable.ts'
import { type ThemeInput, applyTheme, detectColorScheme, resolveThemeInput } from './theme/registry.ts'

/** The active theme for the current component (app theme, or a subtree override). */
export function useTheme(): Theme {
  return inject(ThemeSymbol, darkTheme)
}

/** Override the theme for this component's subtree; merges over the active theme. */
export function provideTheme(theme: Partial<Theme>): Theme {
  const merged: Theme = { ...inject(ThemeSymbol, darkTheme), ...theme }
  provide(ThemeSymbol, merged)
  return merged
}

/**
 * Returns a `setTheme(input, mode?)` that swaps the whole app theme at runtime —
 * by registered name, theme JSON, full `Theme`, or partial override — with one
 * coalesced re-render and no remount. `mode` defaults to the detected light/dark
 * preference. Call inside a component (e.g. from a key handler).
 */
export function useSetTheme(): (input: ThemeInput, mode?: 'dark' | 'light') => void {
  const ctx = inject(HostContextSymbol, null)
  return (input, mode) => {
    if (!ctx) return
    applyTheme(ctx, resolveThemeInput(input, mode ?? detectColorScheme(), ctx.theme))
  }
}
