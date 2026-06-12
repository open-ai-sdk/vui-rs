# @vui-rs/core

## 0.6.0

### Minor Changes

- edece37: add support for all-motion mouse events in terminal session

## 0.5.0

### Minor Changes

- c5d52bb: Distribute the native renderer binary through platform-specific packages
  (`@vui-rs/core-<platform>-<arch>`), declared as optionalDependencies of
  `@vui-rs/core` — npm installs only the binary matching the host os/cpu, and
  `@vui-rs/core` itself no longer bundles any binaries. Inside `bun build
--compile` the loader follows the one platform import that survives
  dead-code elimination, so each compiled executable embeds exactly one binary.
  Cross-compiling consumers must make all platform packages available first
  (`bun install --os="*" --cpu="*"`). Runtime API is unchanged; compiled apps
  still await `getNativeLibAsync()` once at startup.

## 0.4.0

### Minor Changes

- 8ad8262: Support running inside `bun build --compile` single-file executables. The native
  loader now falls back to a per-platform embedded dylib (inlined by the consumer's
  `bun build --compile`, dead-code-eliminated to the target platform only) and
  extracts it to a per-user cache directory (mode 0700, content-hash-verified,
  atomic write) before `dlopen`. New `getNativeLibAsync()` / `loadNativeLibAsync()`
  exports — compiled apps must await one of them once at startup before any
  FFI-using class is constructed; dev and npm-installed usage is unchanged.

## 0.3.0

### Minor Changes

- 0ac3483: FFI loader: extract embedded native lib to a real cache file before dlopen so `bun build --compile` binaries can load vui-core.

  When a compiled binary embeds the native library at a virtual `$bunfs` path, the OS dynamic linker cannot open it directly. The loader now detects this case, copies the bytes to a versioned cache file under the user's temp directory (`vui-rs-ffi-cache/`), and passes that real path to dlopen. Dev workflows (cargo target dirs, node_modules) are unaffected.

## 0.2.0

### Minor Changes

- 748513d: Detect and follow the terminal's light/dark theme: OSC 11 background query
  (`queryColorScheme`), DEC mode 2031 change notifications decoded as `ThemeEvent`,
  and an `onThemeChange` host mount hook.

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
