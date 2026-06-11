// Build @vui-rs/core for publishing. UNBUNDLE mode is deliberate: the native
// loader resolves the `.dylib` via `import.meta.url` with a fixed parent-depth
// (`packages/core/<dir>/native/...` and the repo `target/`). Unbundle mirrors the
// src tree (dist/native/load-native-lib.js sits at the SAME depth as
// src/native/load-native-lib.ts), so those relative paths stay correct — bundling
// into one dist/index.js would shift the depth and break `dlopen`.
//
// `bun:ffi` (Bun-only) and `node:*` are never bundled; this package is Bun-runtime.
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  unbundle: true,
  dts: true,
  platform: 'neutral',
  // `external` is deprecated in tsdown 0.22+; use `deps.neverBundle` instead.
  // - node:* and bun:ffi are runtime-provided, never bundled.
  // - The platform packages (@vui-rs/core-<platform>-<arch>) carry the native
  //   binaries and must stay as verbatim imports so a consumer's `bun build
  //   --compile` follows the one DCE-surviving import and embeds that binary.
  deps: { neverBundle: [/^node:/, 'bun:ffi', /^@vui-rs\/core-/] },
})
