# @vui-rs/vue

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
