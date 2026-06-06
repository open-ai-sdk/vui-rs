// The theme registry: built-in themes (loaded as JSON),
// plus runtime registration for app- or user-supplied themes. `resolveTheme()`
// turns a registered name into a packed `Theme` for a mode; `applyTheme()` swaps
// the active theme on a live host context (one coalesced re-render, no remount).
import type { HostContext } from "../host/renderable.ts";
import type { Theme } from "../theme.ts";
import { type ThemeJson, resolveThemeJson } from "./loader.ts";
import catppuccin from "./builtin/catppuccin.json";
import dracula from "./builtin/dracula.json";
import everforest from "./builtin/everforest.json";
import gruvbox from "./builtin/gruvbox.json";
import nord from "./builtin/nord.json";
import tokyonight from "./builtin/tokyonight.json";

/** Built-in themes, keyed by name. Each carries dark + light. */
export const BUILTIN_THEMES: Record<string, ThemeJson> = {
  catppuccin: catppuccin as ThemeJson,
  dracula: dracula as ThemeJson,
  everforest: everforest as ThemeJson,
  gruvbox: gruvbox as ThemeJson,
  nord: nord as ThemeJson,
  tokyonight: tokyonight as ThemeJson,
};

const registry: Record<string, ThemeJson> = { ...BUILTIN_THEMES };

/** Register (or replace) a theme JSON under `name`, available to `resolveTheme()`. */
export function registerTheme(name: string, json: ThemeJson): void {
  registry[name] = json;
}

/** The raw JSON for a registered theme, or undefined. */
export function getThemeJson(name: string): ThemeJson | undefined {
  return registry[name];
}

/** All registered theme names (built-in + registered). */
export function listThemes(): string[] {
  return Object.keys(registry);
}

/** Resolve a registered theme name to a packed `Theme` for the given mode. */
export function resolveTheme(name: string, mode: "dark" | "light" = "dark"): Theme {
  const json = registry[name];
  if (!json) throw new Error(`vui theme: unknown theme "${name}" (have: ${listThemes().join(", ")})`);
  return resolveThemeJson(json, mode);
}

/**
 * Detect the terminal's light/dark preference without querying it. Honors an
 * explicit `VUI_THEME_MODE`, then `COLORFGBG` (the background ANSI index: 0–6 is
 * dark, 7–15 light — set by many terminals), then defaults to dark.
 */
export function detectColorScheme(): "dark" | "light" {
  const explicit = process.env.VUI_THEME_MODE?.toLowerCase();
  if (explicit === "dark" || explicit === "light") return explicit;
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const parts = fgbg.split(";");
    const bg = Number(parts[parts.length - 1]);
    if (Number.isFinite(bg)) return bg >= 7 ? "light" : "dark";
  }
  return "dark";
}

/** The default dark theme (Catppuccin Mocha) — the app theme when none is set. */
export const darkTheme: Theme = resolveThemeJson(catppuccin as ThemeJson, "dark");
/** The default light theme (Catppuccin Latte). */
export const lightTheme: Theme = resolveThemeJson(catppuccin as ThemeJson, "light");

/** What `setTheme()` accepts: a registered name, a theme JSON, a packed `Theme`, or a partial override. */
export type ThemeInput = string | ThemeJson | Theme | Partial<Theme>;

/** Coerce a `ThemeInput` to a fully packed `Theme` (merging partials over `current`). */
export function resolveThemeInput(
  input: ThemeInput,
  mode: "dark" | "light",
  current: Theme,
): Theme {
  if (typeof input === "string") return resolveTheme(input, mode);
  if ("theme" in input && typeof (input as ThemeJson).theme === "object") {
    return resolveThemeJson(input as ThemeJson, mode);
  }
  // A packed Theme (all tokens) or a partial override: merge over the current theme.
  return { ...current, ...(input as Partial<Theme>) };
}

/**
 * Swap the active theme on a live host context: update the reactive theme in place
 * (so every `useTheme()` reader re-renders), recolor the root canvas, and schedule
 * one coalesced repaint. No remount.
 */
export function applyTheme(ctx: HostContext, theme: Theme): void {
  Object.assign(ctx.theme, theme);
  if (ctx.root) {
    ctx.root.paint.bg = theme.bg;
    ctx.root.paint.fg = theme.fg;
  }
  ctx.scheduleRender();
}
