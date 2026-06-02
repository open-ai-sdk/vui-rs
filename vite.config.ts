// Build vui-rs `.vue` apps for Bun. Vite is browser-oriented, so we use library
// mode (no HTML entry, no DOM) to emit a single ES bundle that Bun executes:
//   vite build  →  dist/app.js  →  bun dist/app.js
//
// The framework + its Bun-native bits are EXTERNAL, never bundled: `bun:ffi` and
// `node:*` are runtime-only, and `@vui-rs/*` must stay external so the native-lib
// loader keeps its `import.meta.url` (bundling it would relocate the lib lookup
// and break `dlopen`). `vue` is aliased to `@vue/runtime-core` — vui-rs has no
// `vue` meta-package, and the custom renderer needs none of runtime-dom.
import { defineConfig } from "vite";
// Relative import (not the package name): Vite loads its config under Node, which
// doesn't see Bun's workspace resolution, so esbuild bundles the plugin source.
import { vuiVitePlugin } from "./packages/vite-plugin/src/index.ts";

export default defineConfig({
  plugins: [vuiVitePlugin()],
  resolve: {
    alias: { vue: "@vue/runtime-core" },
  },
  build: {
    target: "esnext",
    minify: false,
    // Emit into the `examples-sfc` workspace member (not a bare `dist/`): the
    // bundle keeps `@vui-rs/*` external, and Bun only resolves those workspace
    // names for files living inside a workspace package that declares them.
    outDir: "examples-sfc/dist",
    emptyOutDir: true,
    lib: {
      entry: "examples-sfc/main.ts",
      formats: ["es"],
      fileName: () => "app.js",
    },
    rollupOptions: {
      external: [/^bun:/, /^node:/, /^@vui-rs\//, /^@vue\//],
    },
  },
});
