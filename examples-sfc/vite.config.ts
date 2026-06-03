// Build config for THIS example app (it owns its build — not the repo root).
// Vite is browser-oriented, so we use library mode (no HTML entry, no DOM) to
// emit a single ES bundle that Bun executes: `vite build` → `dist/app.js` →
// `bun dist/app.js`.
//
// `@vui-rs/*` and `@vue/*` stay EXTERNAL (never bundle the native loader — it
// resolves the `.dylib` via `import.meta.url`; never duplicate Vue reactivity).
// This package declares those deps, so Bun resolves them when running the bundle.
// `vue` is aliased to `@vue/runtime-core` (no `vue` meta-package here).
import { defineConfig } from "vite";
// Relative import (not the package name): Vite loads its config under Node, which
// doesn't see Bun's workspace resolution, so esbuild bundles the plugin source.
import { vuiVitePlugin } from "../packages/vite-plugin/src/index.ts";

export default defineConfig({
  plugins: [vuiVitePlugin()],
  resolve: {
    alias: { vue: "@vue/runtime-core" },
  },
  build: {
    target: "esnext",
    minify: false,
    emptyOutDir: true,
    lib: {
      entry: "main.ts",
      formats: ["es"],
      fileName: () => "app.js",
    },
    rollupOptions: {
      external: [/^bun:/, /^node:/, /^@vui-rs\//, /^@vue\//],
    },
  },
});
