# @vui-rs/vite-plugin

Vite plugin to compile `.vue` Single-File Components for the [vui-rs](https://github.com/open-ai-sdk/vui-rs) custom renderer. It wraps `@vitejs/plugin-vue` with the TUI-specific adjustments: vui element tags (`<box>`/`<text>`/…), a `v-model` transform for the terminal input contract, and `<style>`-block stripping (a TUI has no CSS).

> Build-time only — runs in the Vite/Rollup process, adds no runtime/FFI surface.

## Install

```sh
bun add -d @vui-rs/vite-plugin vite
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { vuiVitePlugin } from "@vui-rs/vite-plugin";

export default defineConfig({
  plugins: [vuiVitePlugin()],
  resolve: { alias: { vue: "@vue/runtime-core" } },
  build: {
    target: "esnext",
    lib: { entry: "main.ts", formats: ["es"], fileName: () => "app.js" },
    rollupOptions: { external: [/^bun:/, /^node:/, /^@vui-rs\//, /^@vue\//] },
  },
});
```

Then run the built bundle with Bun: `vite build && bun dist/app.js`.

Pass `{ customElements: ["my-tag"] }` for tags registered at runtime via `extend()`.

## License

MIT
