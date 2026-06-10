// Build @vui-rs/rolldown for publishing. Bundled JS + .d.ts. The build deps
// (unplugin-vue, @vue/compiler-core) and the reused @vui-rs/vite-plugin options
// stay external (auto, from package.json) — they're the consumer's own toolchain.
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  platform: 'neutral',
})
