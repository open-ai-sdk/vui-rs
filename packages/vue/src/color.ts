// The color parser lives in `@vui-rs/core` (shared with the Rust named-color
// table for TS↔Rust parity). Re-exported here so the existing in-package import
// sites (`patch-prop`, `paint-prop`, `index`) keep their short `./color.ts` path
// and there is exactly one implementation.
export { parseColor } from '@vui-rs/core'
