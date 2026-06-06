// The theme: a set of semantic color tokens (packed `0xRRGGBBAA`) that drive
// default colors across the tree. Theme
// files load unchanged (see `theme/loader.ts`). The app-level theme is applied to
// the canvas at mount and read by components with `useTheme()`; `setTheme()` swaps
// it at runtime (one re-render, no remount) and `provideTheme()` restyles a
// subtree (a static snapshot — it does not track later `setTheme()` swaps).
// Built-in themes + the JSON loader live under `theme/`.
import type { InjectionKey } from "@vue/runtime-core";

/**
 * Semantic color tokens. Values are packed `0xRRGGBBAA` numbers. 
 * `fg`/`bg`/`muted` are legacy aliases of
 * `text`/`background`/`textMuted`, kept for backward compatibility.
 */
export interface Theme {
  // Brand / highlight.
  primary: number;
  secondary: number;
  /** The one highlight color (spinners, focused affordances, links); maps to `primary`. */
  accent: number;
  // Status.
  error: number;
  warning: number;
  success: number;
  info: number;
  // Text.
  text: number;
  textMuted: number;
  /** Foreground for a selected list item. */
  selectedText: number;
  // Backgrounds.
  background: number;
  backgroundPanel: number;
  backgroundElement: number;
  backgroundMenu: number;
  // Borders.
  border: number;
  borderActive: number;
  borderSubtle: number;
  // Diff.
  diffAdded: number;
  diffRemoved: number;
  diffContext: number;
  diffHunkHeader: number;
  diffAddedBg: number;
  diffRemovedBg: number;
  diffContextBg: number;
  // Markdown.
  markdownText: number;
  markdownHeading: number;
  markdownLink: number;
  markdownLinkText: number;
  markdownCode: number;
  markdownBlockQuote: number;
  markdownEmph: number;
  markdownStrong: number;
  markdownHorizontalRule: number;
  markdownListItem: number;
  markdownListEnumeration: number;
  markdownImage: number;
  markdownImageText: number;
  markdownCodeBlock: number;
  // Syntax (used by the default highlighter palette).
  syntaxComment: number;
  syntaxKeyword: number;
  syntaxFunction: number;
  syntaxVariable: number;
  syntaxString: number;
  syntaxNumber: number;
  syntaxType: number;
  syntaxOperator: number;
  syntaxPunctuation: number;
  // Legacy aliases (mirror text/background/textMuted).
  /** Default foreground (alias of `text`). */
  fg: number;
  /** Canvas background (alias of `background`). */
  bg: number;
  /** De-emphasised text (alias of `textMuted`). */
  muted: number;
}

/** Injection key for the active theme; `useTheme()` reads it, `provideTheme()` sets it. */
export const ThemeSymbol: InjectionKey<Theme> = Symbol("vui.theme");

// The default dark/light themes are resolved from the built-in Catppuccin JSON;
// re-exported here so existing `./theme.ts` import sites keep working.
export { darkTheme, lightTheme } from "./theme/registry.ts";
