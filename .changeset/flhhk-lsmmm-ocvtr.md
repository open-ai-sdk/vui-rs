---
"@vui-rs/core": minor
---

FFI loader: extract embedded native lib to a real cache file before dlopen so `bun build --compile` binaries can load vui-core.

When a compiled binary embeds the native library at a virtual `$bunfs` path, the OS dynamic linker cannot open it directly. The loader now detects this case, copies the bytes to a versioned cache file under the user's temp directory (`vui-rs-ffi-cache/`), and passes that real path to dlopen. Dev workflows (cargo target dirs, node_modules) are unaffected.
