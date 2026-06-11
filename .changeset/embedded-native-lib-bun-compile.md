---
"@vui-rs/core": minor
---

Support running inside `bun build --compile` single-file executables. The native
loader now falls back to a per-platform embedded dylib (inlined by the consumer's
`bun build --compile`, dead-code-eliminated to the target platform only) and
extracts it to a per-user cache directory (mode 0700, content-hash-verified,
atomic write) before `dlopen`. New `getNativeLibAsync()` / `loadNativeLibAsync()`
exports — compiled apps must await one of them once at startup before any
FFI-using class is constructed; dev and npm-installed usage is unchanged.
