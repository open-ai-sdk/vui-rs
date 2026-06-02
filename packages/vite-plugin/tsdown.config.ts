// Build @vui-rs/vite-plugin for publishing. Bundled JS + .d.ts. The build deps
// (@vitejs/plugin-vue, @vue/compiler-core) and the `vite` peer stay external
// (auto, from package.json) — they're the consumer's own toolchain.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
