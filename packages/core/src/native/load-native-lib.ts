import { dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/native -> repo root is four levels up.
const repoRoot = join(here, "..", "..", "..", "..");

/**
 * FFI symbol table. MUST stay in lockstep with the `#[unsafe(no_mangle)]
 * extern "C"` exports in crates/vui-core/src/lib.rs. Any change here is an ABI
 * change — bump ABI_VERSION on both sides.
 */
export const symbols = {
  vui_version: { args: [], returns: FFIType.u32 },
  vui_abi_version: { args: [], returns: FFIType.u32 },
} as const;

/**
 * TS-side mirror of `ABI_VERSION` in crates/vui-core/src/lib.rs. Moves in
 * lockstep with the symbol table above; `loadNativeLib` enforces it at load so
 * no downstream caller can run against a mismatched library.
 */
export const EXPECTED_ABI_VERSION = 1;

function libFileName(): string {
  // Windows produces `vui_core.dll`; Unix toolchains prefix with `lib`.
  const prefix = process.platform === "win32" ? "" : "lib";
  return `${prefix}vui_core.${suffix}`;
}

/**
 * Library lookup order:
 *  1. Stable copy produced by `scripts/build-native.ts` (what releases use).
 *  2. Dev fallbacks: the cargo workspace build directory (release, then debug).
 */
function candidatePaths(): string[] {
  const file = libFileName();
  const platformArch = `${process.platform}-${process.arch}`;
  const buildDir = join(repoRoot, "target");
  return [
    join(here, "..", "..", "native", platformArch, file),
    join(buildDir, "release", file),
    join(buildDir, "debug", file),
  ];
}

function open(path: string) {
  return dlopen(path, symbols);
}

export type NativeLib = ReturnType<typeof open>;

let cached: NativeLib | undefined;

/**
 * Resolve, `dlopen`, ABI-check, and memoize the vui-core native library.
 *
 * When several candidates exist (e.g. a debug build alongside a stale release
 * copy) the most recently modified one wins, so a fresh `cargo build` always
 * takes precedence over an old artifact during iterative development.
 */
export function loadNativeLib(): NativeLib {
  if (cached) return cached;
  const candidates = candidatePaths();
  const existing = candidates.filter((p) => existsSync(p));
  if (existing.length === 0) {
    throw new Error(
      "vui-core native library not found. Searched:\n" +
        candidates.map((p) => `  - ${p}`).join("\n") +
        "\nBuild it with: bun run build:native",
    );
  }
  const path = existing.reduce((newest, p) =>
    statSync(p).mtimeMs > statSync(newest).mtimeMs ? p : newest,
  );
  const lib = open(path);
  const abi = lib.symbols.vui_abi_version();
  if (abi !== EXPECTED_ABI_VERSION) {
    throw new Error(
      `vui-core ABI mismatch: native=${abi}, expected=${EXPECTED_ABI_VERSION}. ` +
        "Rebuild the native lib: bun run build:native",
    );
  }
  cached = lib;
  return cached;
}
