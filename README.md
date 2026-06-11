# vui-rs

Build beautiful **terminal UIs with Vue** — a Rust rendering engine (native cell buffer, truecolor, unicode, [taffy](https://github.com/DioxusLabs/taffy) flexbox, images) driven from **Bun** via FFI, with a Vue 3 custom renderer and a component library on top.

> **Runtime:** Bun (the engine loads a native library through `bun:ffi`).

## Packages

| Package | What it is |
|---------|-----------|
| [`@vui-rs/core`](packages/core) | Native terminal rendering engine (Rust cdylib + FFI bindings). |
| [`@vui-rs/vue`](packages/vue) | Vue 3 custom renderer — elements, layout, input, overlays, rich text, animation, theming. |
| [`@vui-rs/ui`](packages/ui) | App-level components — dialogs, command palette, toasts, autocomplete, status bars, virtual list. |
| [`@vui-rs/vite-plugin`](packages/vite-plugin) | Compile `.vue` SFCs for the custom renderer in Vite builds. |
| [`@vui-rs/rolldown`](packages/rolldown) | Compile `.vue` SFCs for the custom renderer in rolldown/tsdown builds. |

## Quick start

```sh
bun add @vui-rs/vue
```

Author components either with the `h` render function (no build step) or as `.vue` Single File Components (needs the SFC compiler plugin — see below).

### Render function

```ts
import { createApp, h, ref } from "@vui-rs/vue";

const App = {
  setup() {
    const n = ref(0);
    return () => h("box", { border: "rounded", padding: 1 }, h("text", {}, `count: ${n.value}`));
  },
};
createApp(App).mount();
```

### Single File Component (`.vue`)

Prefer `<template>` + `<script setup>`? Write the same app as an SFC:

```vue
<!-- App.vue -->
<template>
  <box border="rounded" :padding="1">
    <text>count: {{ n }}</text>
  </box>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";
const n = ref(0);
</script>
```

```ts
// main.ts
import { createApp } from "@vui-rs/vue";
import App from "./App.vue";

createApp(App).mount();
```

SFCs need a build step to compile `.vue` files for the custom renderer: add [`@vui-rs/vite-plugin`](packages/vite-plugin) (`plugins: [vuiVitePlugin()]`) for Vite, or [`@vui-rs/rolldown`](packages/rolldown) for rolldown/tsdown builds. See [`examples/`](examples) — every demo is SFC-based.

See [`examples/`](examples) for runnable demos (`bun run dev:gallery`, `dev:dialogs`, `dev:virtual-list`, …) and [`docs/`](docs) for the API reference.

## Development

```sh
bun install              # also installs vp git hooks (vp config)
bun run build:native     # build the Rust engine for your platform
bun run test             # cargo + bun test suites + ABI probe
bun run lint             # oxlint (via vite-plus / vp)
bun run fmt              # oxfmt — single quotes, no semicolons, 120 cols
bun run build            # cached package builds (vp run)
```

## Releasing

Versioning is managed with [Changesets](https://github.com/changesets/changesets); publishing runs on CI via `bun publish` (resolves `workspace:`/`catalog:` protocols). Add a changeset with `bun run changeset`. See [`.github/workflows/release.yml`](.github/workflows/release.yml).

## License

[MIT](LICENSE) © evann (open-ai-sdk)
