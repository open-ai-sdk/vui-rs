# @vui-rs/vue

## 0.7.0

### Minor Changes

- 6691dd7: Add per-token highlight to the native `<textarea>` editor. `EditorView.setHighlights(ranges, color)` paints the given grapheme-offset ranges in an accent fg (new FFI `vui_editor_set_highlights`, ABI 14). The `<textarea>` gains `highlightSigil` + `highlightColor` props: whitespace-delimited tokens starting with the sigil (e.g. `$skill`) render in the accent color, computed in the host with the editor's grapheme-offset model. No effect when the props are unset.

### Patch Changes

- Updated dependencies [6691dd7]
  - @vui-rs/core@0.7.0

## 0.6.5

### Patch Changes

- e0cf9b9: Fix textarea auto-height measurement for percentage-width, bordered textareas so soft-wrapped lines expand the outer box immediately.

## 0.6.4

### Patch Changes

- e4c0c32: Add textarea key escape hatches and input parity for composer-style controls: cursorBlink, opt-in linefeed fallback for newline shortcuts, Tab/Ctrl+C capture, selected key bubbling, maxLength insertion caps, and readline delete shortcuts.
- Updated dependencies [e4c0c32]
  - @vui-rs/core@0.6.1

## 0.6.3

### Patch Changes

- 29e3250: Add an opt-in textarea submit mode so Enter can emit `submit` while Ctrl+Enter inserts a newline.

## 0.6.2

### Patch Changes

- Updated dependencies [edece37]
  - @vui-rs/core@0.6.0

## 0.6.1

### Patch Changes

- 2415a82: Fix `<input>` block cursor blanking the placeholder's first character. With an
  empty value, the focused cursor now reveals the placeholder glyph underneath it
  (e.g. the "A" of "Ask…") instead of painting a space over it — previously the
  first placeholder char appeared to vanish, and flickered once the cursor blinked.

## 0.6.0

### Minor Changes

- e09b81c: `<input>` now renders a blinking block cursor while focused (classic ~530ms
  xterm rate), instead of a static cell. The caret goes solid the instant you
  type or move and resumes blinking when idle. Blink is on by default for every
  `<input>`; a new `cursorBlink` prop tunes it — `false` keeps a steady cursor,
  a number sets a custom half-period in ms. `<textarea>` is unaffected.

## 0.5.4

### Patch Changes

- c9b61d3: add cancelable paste event support to VuiHostInput and VuiHostTextarea components

## 0.5.3

### Patch Changes

- Updated dependencies [c5d52bb]
  - @vui-rs/core@0.5.0

## 0.5.2

### Patch Changes

- Updated dependencies [8ad8262]
  - @vui-rs/core@0.4.0

## 0.5.1

### Patch Changes

- Updated dependencies [0ac3483]
  - @vui-rs/core@0.3.0

## 0.5.0

### Minor Changes

- 748513d: Detect and follow the terminal's light/dark theme: OSC 11 background query
  (`queryColorScheme`), DEC mode 2031 change notifications decoded as `ThemeEvent`,
  and an `onThemeChange` host mount hook.

### Patch Changes

- Updated dependencies [748513d]
  - @vui-rs/core@0.2.0

## 0.4.0

### Minor Changes

- 7b41400: add copy-on-select functionality with clipboard integration and user scroll handling

## 0.3.0

### Minor Changes

- 88aa6e1: Add an opt-in `onCtrlC` host hook (additive, no breaking changes):

  - **`HostMountOptions.onCtrlC?: () => void`** — take over the decision for an otherwise-unhandled Ctrl+C instead of the host's default `unmount()` + `process.exit(0)`. It only fires for presses that would have exited; the higher-priority paths still win first and never reach it: active-selection copy (OSC 52), a focused textarea with a selection, and a focused input with `ctrlCBehavior: 'capture'` that consumes the press (`preventDefault`). When set, the app owns exiting itself — letting a TUI show an exit-confirm prompt before quitting. With the option absent, behavior is byte-identical to before.

## 0.2.0

### Minor Changes

- 78ebaea: Add anchor-tracking + click-focus opt-out primitives for popups (additive, no breaking changes):

  - **`useElementRect(elRef)`** — reactively read an element's absolute screen rect (`{ x, y, width, height }` in terminal cells), refreshed whenever layout recomputes (resize, content reflow, a dock/sibling appearing). Lets a popup anchor itself to another element (e.g. an input) with no polling. Not driven by paint-only scroll offsets, so anchor an element that is a sibling of any scroll viewport, not a descendant of one. Backed by a new `getScreenRect` walk and a layout-tick subscription on the host context.
  - **`clickFocus` prop** (default `true`) — a focusable container with `clickFocus: false` still accepts `:focused`/programmatic focus and key dispatch, but is skipped by click-to-focus and Tab traversal. An app shell can hold focus for global keys while busy without a click on the rest of the UI stealing focus from the input.

## 0.1.10

### Patch Changes

- 4d61d3b: add onErrorCaptured lifecycle hook to index export

## 0.1.9

### Patch Changes

- 1182f65: `<input>` gains readline-style line editing:

  - **Ctrl+U** → delete to line start
  - **Ctrl+W**, **Ctrl+Backspace**, **Alt+Backspace** → delete the previous word
  - **Ctrl+K** → delete to line end

  Backed by new `EditRenderable` ops `deleteToStart()`, `deleteWordLeft()`, `deleteToEnd()`. Plain `u`/`w`/`k` still type normally — the actions require the Ctrl modifier.

## 0.1.8

### Patch Changes

- a37dc6b: `<input>` gains a `ctrlCBehavior` prop (`'exit'` default | `'capture'`).

  With `'capture'`, the host dispatches Ctrl+C to the focused input first (so a `keyDown` handler can e.g. clear the text) and only quits the app if the event is left unhandled — i.e. an empty input still exits on Ctrl+C, but a non-empty one can intercept it. Mirrors the existing `tabBehavior` opt-in and the textarea copy-on-selection carve-out.

## 0.1.7

### Patch Changes

- 7c75c8a: Autocomplete: Tab-to-complete support.

  - `@vui-rs/ui` `useAutocomplete` now handles **Tab** in `onKeyDown` — it completes the active suggestion via a new optional `onComplete` callback (falls back to `onAccept` when omitted), so Tab can fill the input text without executing the selection.
  - `@vui-rs/vue` `<input>` gains a `tabBehavior` prop (`'focus'` default | `'capture'`). With `'capture'`, the host dispatches Tab to the focused input (it ignores Tab, so the event bubbles to the wrapper's `keyDown`) instead of moving focus — letting a `useAutocomplete` wrapper drive Tab completion. Mirrors the existing `<textarea tabBehavior="indent">` opt-out.

## 0.1.6

### Patch Changes

- 6c6298e: prevent text selection when clicking on interactive elements

## 0.1.5

### Patch Changes

- 1daedba: prevent scrollbar from disappearing and ensure content wraps correctly

## 0.1.4

### Patch Changes

- 664d7a8: fix: ensure reactive focus management for input components

## 0.1.3

### Patch Changes

- 45d0e6a: Fix scroll bar flicker

## 0.1.2

### Patch Changes

- d407468: Fix stale internal dependency versions in published packages.

  `bun publish` resolves a `workspace:*` dependency to the version recorded in
  `bun.lock`, not the bumped `package.json` version. `ci:version` ran
  `bun install --lockfile-only`, which does not re-resolve workspace references, so
  the lockfile kept the previous version — `@vui-rs/vue@0.1.1` and `@vui-rs/ui@0.1.1`
  published with `@vui-rs/core` pinned to `0.1.0` (the unimportable build), making
  them fail to install. `ci:version` now runs `bun update` so the lockfile resolves
  internal deps to the current versions before publish.

- Updated dependencies [d407468]
  - @vui-rs/core@0.1.2

## 0.1.1

### Patch Changes

- 0dde4a2: Fix unimportable published packages by pointing `exports`/`module`/`types` at `dist/`.

  Each package previously kept `exports` at `./src/index.ts` for in-repo dev and
  relied on a `publishConfig` block to swap in the `dist/` paths at publish. But
  `bun publish` (used so `workspace:`/`catalog:` protocols get resolved) does not
  apply the `publishConfig` overlay the way `npm publish` does, so the published
  manifests shipped the `src/` paths while the tarball contained only `dist/` —
  consumers hit `Cannot find module '@vui-rs/...'`.

  `publishConfig` is removed; `exports`/`module`/`types` now point at `dist/`
  directly (single source of truth, identical in dev and on npm). Packages must be
  built before running examples or typechecking, so `build:packages` builds in
  dependency order (core → vue → ui → vite-plugin) and `dev:*` / `build:examples`
  run it first.

- Updated dependencies [0dde4a2]
  - @vui-rs/core@0.1.1
