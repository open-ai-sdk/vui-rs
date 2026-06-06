// Build @vui-rs/ui for publishing. Bundled (single dist/index.js + dist/index.d.ts)
// — the app-level component library has no `import.meta.url` path logic, so
// bundling is safe. The Vue runtime, @vui-rs/core, and @vui-rs/vue stay external
// (auto, from package.json deps): never bundle the native loader (it lives in
// @vui-rs/core), the host renderer, or duplicate Vue reactivity.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
