# @vui-rs/core-darwin-x64

## 0.7.0

## 0.6.1

## 0.6.0

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
