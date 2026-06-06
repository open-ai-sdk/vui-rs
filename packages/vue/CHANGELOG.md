# @vui-rs/vue

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
