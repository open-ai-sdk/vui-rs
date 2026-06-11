# @vui-rs/ui

## 0.2.7

### Patch Changes

- Updated dependencies [c5d52bb]
  - @vui-rs/core@0.5.0
  - @vui-rs/vue@0.5.3

## 0.2.6

### Patch Changes

- Updated dependencies [8ad8262]
  - @vui-rs/core@0.4.0
  - @vui-rs/vue@0.5.2

## 0.2.5

### Patch Changes

- Updated dependencies [0ac3483]
  - @vui-rs/core@0.3.0
  - @vui-rs/vue@0.5.1

## 0.2.4

### Patch Changes

- Updated dependencies [748513d]
  - @vui-rs/core@0.2.0
  - @vui-rs/vue@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [7b41400]
  - @vui-rs/vue@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [88aa6e1]
  - @vui-rs/vue@0.3.0

## 0.2.1

### Patch Changes

- b84297d: `VuiAutocomplete` can show a "no results" placeholder (additive, backward compatible):

  - New **`emptyText`** prop: when there are no suggestions, the popup renders a single non-interactive muted row with this text (e.g. "No matching items") instead of disappearing. Works in both overlay (`anchor`) and in-flow modes; the empty row reserves one line in the height/clamp math and emits no `select`.
  - Omitting `emptyText` keeps the original behavior — an empty suggestion list renders nothing — so existing consumers are unchanged.

  This lets a consumer that mounts the popup while a trigger is active (e.g. a `/` command menu) keep it open and show a "no match" hint.

## 0.2.0

### Minor Changes

- 78ebaea: `VuiAutocomplete` can render as an anchored overlay popup (additive, backward compatible):

  - New **`anchor`** prop (a screen rect, e.g. from `useElementRect`): the suggestion list renders as a z-indexed `<overlay>` that opens **upward** above the anchor — no layout shift in the main tree, clamped to the space above the anchor so it never overflows the top of the screen, and the popup carries no focus trap so the input keeps focus.
  - **Windowed scrolling**: the visible suggestions now scroll a window that keeps the active row in view, so rows beyond `maxRows` are reachable (the old `slice(0, maxRows)` made them unreachable).
  - Omitting `anchor` keeps the original in-flow rendering under the input, so existing consumers are unchanged.

### Patch Changes

- Updated dependencies [78ebaea]
  - @vui-rs/vue@0.2.0

## 0.1.10

### Patch Changes

- Updated dependencies [4d61d3b]
  - @vui-rs/vue@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [1182f65]
  - @vui-rs/vue@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [a37dc6b]
  - @vui-rs/vue@0.1.8

## 0.1.7

### Patch Changes

- 7c75c8a: Autocomplete: Tab-to-complete support.

  - `@vui-rs/ui` `useAutocomplete` now handles **Tab** in `onKeyDown` — it completes the active suggestion via a new optional `onComplete` callback (falls back to `onAccept` when omitted), so Tab can fill the input text without executing the selection.
  - `@vui-rs/vue` `<input>` gains a `tabBehavior` prop (`'focus'` default | `'capture'`). With `'capture'`, the host dispatches Tab to the focused input (it ignores Tab, so the event bubbles to the wrapper's `keyDown`) instead of moving focus — letting a `useAutocomplete` wrapper drive Tab completion. Mirrors the existing `<textarea tabBehavior="indent">` opt-out.

- Updated dependencies [7c75c8a]
  - @vui-rs/vue@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [6c6298e]
  - @vui-rs/vue@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [1daedba]
  - @vui-rs/vue@0.1.5

## 0.1.4

### Patch Changes

- 664d7a8: fix: ensure reactive focus management for input components
- Updated dependencies [664d7a8]
  - @vui-rs/vue@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [45d0e6a]
  - @vui-rs/vue@0.1.3

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
  - @vui-rs/vue@0.1.2

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
  - @vui-rs/vue@0.1.1
