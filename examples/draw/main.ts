#!/usr/bin/env bun
// The draw example uses <canvas @draw>, a JS-host element, so it mounts on the
// JS host (createHostApp) rather than the FFI host.
import { createHostApp } from "@vui-rs/vue";
import App from "./App.vue";

createHostApp(App).mount();
