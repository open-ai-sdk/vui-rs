// Shared Vite config for every example workspace (DRY). Vite is browser-oriented,
// so we use library mode (no HTML, no DOM) to emit one ES bundle Bun executes:
// `vite build` → `dist/app.js` → `bun dist/app.js`.
//
// `@vui-rs/*` and `@vue/*` stay EXTERNAL (never bundle the native loader — it
// resolves the `.dylib` via `import.meta.url`; never duplicate Vue reactivity).
// Each example declares those deps, so Bun resolves them when running the bundle.
// `vue` aliases to `@vue/runtime-core` (no `vue` meta-package here).
import { defineConfig } from 'vite'
// Relative import (not the package name): Vite loads its config under Node, which
// doesn't see Bun's workspace resolution, so esbuild bundles the plugin source.
import { vuiVitePlugin } from '../packages/vite-plugin/src/index.ts'

/** Build config for an example workspace whose entry is `entry` (default `main.ts`). */
export function vuiExample(entry = 'main.ts') {
  return defineConfig({
    plugins: [vuiVitePlugin()],
    resolve: { alias: { vue: '@vue/runtime-core' } },
    build: {
      target: 'esnext',
      minify: false,
      emptyOutDir: true,
      lib: { entry, formats: ['es'], fileName: () => 'app.js' },
      rollupOptions: { external: [/^bun:/, /^node:/, /^@vui-rs\//, /^@vue\//] },
    },
  })
}
