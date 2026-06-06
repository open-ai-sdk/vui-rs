# @vui-rs/core

Native terminal rendering engine for [vui-rs](https://github.com/open-ai-sdk/vui-rs) — a Rust cell buffer (truecolor, unicode/grapheme width, borders, [taffy](https://github.com/DioxusLabs/taffy) flexbox layout, inline images) driven from **Bun** via FFI.

> **Runtime:** Bun only. This package loads a native library through `bun:ffi`; it does not run under Node.js.

## Install

```sh
bun add @vui-rs/core
```

Prebuilt native binaries for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64` ship inside the package; the loader picks the right one at runtime.

## Usage

```ts
import { Renderer } from "@vui-rs/core";

const r = new Renderer(80, 24);
// …draw into the cell buffer, then flush.
r.free();
```

Most apps use [`@vui-rs/vue`](https://www.npmjs.com/package/@vui-rs/vue) (a Vue custom renderer) on top of this engine rather than calling it directly.

## License

MIT
