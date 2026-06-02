#!/usr/bin/env bun
// End-to-end toolchain proof: load the Rust cdylib over bun:ffi and read its
// version probe. `getNativeLib()` already enforces the ABI version on load, so
// reaching this line means the whole Rust -> Bun FFI chain works.
import { getNativeLib } from "@vui-rs/core";

const packed = getNativeLib().symbols.vui_version();
const major = (packed >>> 16) & 0xff;
const minor = (packed >>> 8) & 0xff;
const patch = packed & 0xff;

console.log(`vui-core v${major}.${minor}.${patch}`);
