#!/usr/bin/env bun
// ABI/version probe (the `test` script's end-to-end FFI check, replacing the old
// examples/smoke-version.ts). Loading the native lib ABI-checks it against
// EXPECTED_ABI_VERSION; reaching this line proves the whole Rust → Bun FFI chain
// works at the agreed ABI. Exits non-zero on mismatch.
import { EXPECTED_ABI_VERSION, getNativeLib } from '@vui-rs/core'

const lib = getNativeLib()
const abi = lib.symbols.vui_abi_version()
const packed = lib.symbols.vui_version()
const major = (packed >>> 16) & 0xff
const minor = (packed >>> 8) & 0xff
const patch = packed & 0xff

console.log(`vui-core v${major}.${minor}.${patch} (ABI ${abi}, expected ${EXPECTED_ABI_VERSION})`)
if (abi !== EXPECTED_ABI_VERSION) {
  console.error(`ABI mismatch: native=${abi}, expected=${EXPECTED_ABI_VERSION}`)
  process.exit(1)
}
