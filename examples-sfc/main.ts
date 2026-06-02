#!/usr/bin/env bun
// Entry for the SFC example. Built by Vite (`vite build`) into `dist/app.js`, then
// run with Bun (`bun dist/app.js`). `createApp(App).mount()` is identical to the
// `h()` path — the only difference is `App` came from a compiled `.vue` file.
import { createApp } from "@vui-rs/vue";
import App from "./App.vue";

createApp(App).mount();
