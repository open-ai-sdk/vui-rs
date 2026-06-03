// Build @vui-rs/core for publishing. UNBUNDLE mode is deliberate: the native
// loader resolves the `.dylib` via `import.meta.url` with a fixed parent-depth
// (`packages/core/<dir>/native/...` and the repo `target/`). Unbundle mirrors the
// src tree (dist/native/load-native-lib.js sits at the SAME depth as
// src/native/load-native-lib.ts), so those relative paths stay correct — bundling
// into one dist/index.js would shift the depth and break `dlopen`.
//
// `bun:ffi` (Bun-only) and `node:*` stay external; this package is Bun-runtime.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  unbundle: true,
  dts: true,
  platform: "neutral",
  external: [/^node:/, "bun:ffi"],
  // Copy the prebuilt native lib(s) from `native/<arch>/` (populated by
  // scripts/build-native.ts) into `dist/native/<arch>/`, so `dist/` is
  // self-contained. tsdown copies a `from` dir as `to/<basename>`, so `to: dist`
  // yields `dist/native/<arch>/`. The loader's first candidate (`here/<arch>/lib`,
  // here = `dist/native`) resolves it at runtime.
  copy: [{ from: "native", to: "dist" }],
});
