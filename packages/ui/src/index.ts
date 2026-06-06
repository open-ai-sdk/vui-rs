// @vui-rs/ui — the application-level component library for vui-rs terminal UIs.
// Every export here is a plain Vue component (or composable) built on the
// @vui-rs/vue host primitives — overlays (z-index/backdrop), scroll/cull, the
// animation engine, and the theme system — with no Rust/core changes. This is the
// layer an AI-coding CLI (or any rich TUI) renders its chrome from: dialogs,
// selects, a command palette, toasts, autocomplete, status bars, a virtual list,
// and busy indicators. Components are theme-aware (read `useTheme()`), keyboard-
// first, and small (each file is a focused widget).

// Fuzzy search used by select / palette / autocomplete.
export {
  type FuzzyMatch,
  type FuzzyRanked,
  fuzzyMatch,
  fuzzyFilter,
} from "./fuzzy.ts";

// Modal focus bookkeeping (confinement lives in the host focus manager).
export { useFocusTrap } from "./use-focus-trap.ts";

// Dialog family: a base modal + the common variants.
export { VuiDialog, type DialogSize } from "./dialog.ts";
export { VuiDialogSelect } from "./dialog-select.ts";
export { VuiDialogPrompt } from "./dialog-prompt.ts";
export { VuiDialogConfirm } from "./dialog-confirm.ts";
export { VuiDialogAlert } from "./dialog-alert.ts";

// Command palette, toasts, autocomplete.
export {
  VuiCommandPalette,
  type Command,
} from "./command-palette.ts";
export {
  VuiToastHost,
  useToast,
  provideToasts,
  type Toast,
  type ToastKind,
  type ToastController,
} from "./toast.ts";
export {
  VuiAutocomplete,
  useAutocomplete,
  type Suggestion,
  type SuggestionProvider,
  type AutocompleteApi,
  type AutocompleteOptions,
} from "./autocomplete.ts";

// Select option type (shared by dialog-select).
export { type SelectOption } from "./dialog-select.ts";

// Fixed chrome regions + large-list + busy indicators.
export { VuiStatusBar, VuiHeader, VuiFooter } from "./status-bar.ts";
export { VuiVirtualList } from "./virtual-list.ts";
export { VuiWorkingIndicator } from "./working-indicator.ts";

// Re-export the base spinner so apps can pull all busy indicators from @vui-rs/ui.
export { VuiSpinner, SPINNER_PRESETS, type SpinnerPreset } from "@vui-rs/vue";
