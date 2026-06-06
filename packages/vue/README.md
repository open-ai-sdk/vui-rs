# @vui-rs/vue

A **Vue 3 custom renderer** for [vui-rs](https://github.com/open-ai-sdk/vui-rs): build reactive terminal UIs with Vue's component model, reactivity, and lifecycle — rendered through the native cell buffer in [`@vui-rs/core`](https://www.npmjs.com/package/@vui-rs/core).

> **Runtime:** Bun only (depends on `@vui-rs/core`'s FFI engine).

## Install

```sh
bun add @vui-rs/vue
```

## Usage

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

Authoring `.vue` SFCs? Add [`@vui-rs/vite-plugin`](https://www.npmjs.com/package/@vui-rs/vite-plugin). Higher-level widgets (dialogs, command palette, toasts, …) live in [`@vui-rs/ui`](https://www.npmjs.com/package/@vui-rs/ui).

## Features

Box/text/span elements · taffy flexbox layout · truecolor + text attributes · borders + titles · `<input>`/`<textarea>` (native edit, undo/redo, selection) · `<canvas>` · `<scroll-box>` (scroll + cull) · overlays/modals (z-index + dim backdrop) · `<markdown>`/`<code>`/`<diff>` · animation/timeline engine · theming (light/dark, runtime switch) · keyboard + mouse + focus · text selection + OSC 52 copy · inline images.

## License

MIT
