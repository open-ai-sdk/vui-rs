# Code Standards — vui-rs

Conventions and pinned toolchain/dependencies for the dual Cargo + Bun monorepo.

## Toolchain

| Tool  | Minimum | Validated on |
|-------|---------|--------------|
| Rust  | 1.94    | rustc 1.94.1 (edition 2024) |
| Bun   | 1.3     | 1.3.13 |

Cargo workspace uses `resolver = "3"`. Edition is `2024` across crates.

## Pinned Rust dependencies

Exact-pinned (`=x.y.z`) for reproducible builds, declared in
`crates/vui-core/Cargo.toml`. `unicode-width`/`unicode-segmentation` are active
as of Phase 01; `taffy` stays commented until Phase 02.

| Crate                  | Version  | Used from | Purpose |
|------------------------|----------|-----------|---------|
| `taffy`                | `0.10.1` | Phase 02  | Flexbox layout engine |
| `unicode-width`        | `0.2.2`  | Phase 01  | Terminal cell width of grapheme/char |
| `unicode-segmentation` | `1.13.3` | Phase 01  | Grapheme cluster segmentation |

## Pinned TS dependencies

The runtime depends on Bun's built-in `bun:ffi` (no npm FFI package). Vue
runtime packages are introduced in Phase 03.

| Package              | Version range | Used from | Notes |
|----------------------|---------------|-----------|-------|
| `@vue/runtime-core`  | TBD (Phase 03)| Phase 03  | Custom renderer host |
| `@vue/reactivity`    | TBD (Phase 03)| Phase 03  | Reactivity (transitive `@vue/shared`) |

Dev-only: `typescript ^5.9`, `@types/bun ^1.3`. `bun.lock` is committed for
reproducibility.

## FFI / ABI conventions

- Every exported function is `#[unsafe(no_mangle)] pub extern "C"` (the
  `unsafe(...)` wrapper is required in edition 2024).
- Wrap each export body in `std::panic::catch_unwind` — a panic must never
  unwind across the C ABI. Return a documented sentinel on panic.
- The native `ABI_VERSION` constant and the TS `EXPECTED_ABI_VERSION` constant
  move in lockstep. Bump both on any exported-signature or `#[repr(C)]` layout
  change. The loader/smoke test refuses a mismatch.
- The FFI symbol table is the single source of truth in
  `packages/core/src/native/ffi-symbols.ts` (mirrors the `extern "C"` exports).
- `#[repr(C)]` structs shared zero-copy (e.g. `Cell`, 16 bytes) have a size
  probe (`vui_cell_size_bytes`) the loader checks against the TS `CELL_BYTES`
  constant, so a layout drift fails loud at load — not as silent corruption.
- Native library name: `libvui_core.{dylib,so}` on Unix, `vui_core.dll` on
  Windows. The FFI loader resolves a stable copy under
  `packages/core/native/<platform>-<arch>/`, falling back to the cargo build dir.
  When more than one candidate exists, the **most recently modified** wins, so a
  fresh `cargo build` (debug) always beats a stale `--release` copy during dev.

## Packaging

- `@vui-rs/core` / `@vui-rs/vue` are `private` for v0 (local build only; prebuilt
  per-platform npm packages are post-MVP). Drop `private` and add publish
  metadata when distribution lands.
- Workspace globs: `["packages/*", "examples"]`. `examples` is a single package
  holding demo scripts directly; revisit if a per-demo package layout is needed.

## Naming

- Rust files: `snake_case.rs`. TS files: `kebab-case.ts`.
- Workspace package names: `@vui-rs/<name>`.
