// Build @vui-rs/vue for publishing. Bundled (single dist/index.js + dist/index.d.ts)
// — this package has no `import.meta.url` path logic, so bundling is safe. The Vue
// runtime and @vui-rs/core stay external (auto, from package.json deps): never
// bundle the native loader (it lives in @vui-rs/core) or duplicate Vue reactivity.
//
// The GlobalComponents augmentation (src/vui-elements.d.ts, referenced from
// index.ts) MUST survive into dist/index.d.ts so Volar keeps recognising
// <box>/<text>/<input> for consumers — verified after build.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
