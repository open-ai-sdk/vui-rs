# @vui-rs/ui

Application-level component library for [vui-rs](https://github.com/open-ai-sdk/vui-rs) terminal UIs — the "chrome" an AI-CLI or rich TUI renders, built entirely on [`@vui-rs/vue`](https://www.npmjs.com/package/@vui-rs/vue) primitives.

> **Runtime:** Bun only.

## Install

```sh
bun add @vui-rs/ui
```

## Components

- **Dialogs** — `VuiDialog` (modal: overlay + dim backdrop + focus-trap + Esc), `VuiDialogConfirm`, `VuiDialogAlert`, `VuiDialogPrompt` (validate), `VuiDialogSelect` (fuzzy filter + groups + highlight).
- **`VuiCommandPalette`** — Ctrl-K launcher with fuzzy search + keybind hints + dispatch.
- **Toasts** — `provideToasts()` / `useToast()` / `<VuiToastHost>` (queue, auto-dismiss, corner overlay).
- **Autocomplete** — `useAutocomplete()` provider stack + `<VuiAutocomplete>` popup.
- **Chrome** — `VuiStatusBar` / `VuiHeader` / `VuiFooter`.
- **`VuiVirtualList`** — windowed mounting (O(visible)) for 100k+ rows, with optional scrollbar + controlled `scrollY`.
- **`VuiWorkingIndicator`** + spinner presets, and a dependency-free `fuzzyMatch` / `fuzzyFilter`.

```ts
import { VuiCommandPalette, type Command } from "@vui-rs/ui";
```

See the [`component-gallery` example](https://github.com/open-ai-sdk/vui-rs/tree/main/examples/component-gallery) for all of them in one app.

## License

MIT
