import { dlopen, suffix } from "bun:ffi";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CELL_BYTES, EXPECTED_ABI_VERSION, STYLE_FFI_BYTES, symbols } from "./ffi-symbols.ts";

export {
  Attr,
  CELL_BYTES,
  EditMotion,
  type EditMotionCode,
  EXPECTED_ABI_VERSION,
  LINK_SHIFT,
  NativeTextWrap,
  type NativeTextWrapCode,
  NodeKindCode,
  Status,
  STYLE_FFI_BYTES,
  symbols,
  TEXT_RUN_FFI_BYTES,
} from "./ffi-symbols.ts";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/native -> repo root is four levels up.
const repoRoot = join(here, "..", "..", "..", "..");

function libFileName(): string {
  // Windows produces `vui_core.dll`; Unix toolchains prefix with `lib`.
  const prefix = process.platform === "win32" ? "" : "lib";
  return `${prefix}vui_core.${suffix}`;
}

/**
 * Library lookup order (the newest existing candidate actually wins — see
 * `loadNativeLib`):
 *  1. Published layout: dylib copied next to the loader inside `dist/` by the
 *     tsdown `copy` step (`dist/native/<arch>/`). The only candidate that exists
 *     in a published package.
 *  2. Dev: stable copy produced by `scripts/build-native.ts` at the package's
 *     `native/<arch>/` dir.
 *  3. Dev fallbacks: the cargo workspace build directory (release, then debug).
 *
 * `here` is `<pkg>/src/native` in dev and `<pkg>/dist/native` in a build — both
 * sit at the same depth, so the relative joins resolve correctly either way.
 */
function candidatePaths(): string[] {
  const file = libFileName();
  const platformArch = `${process.platform}-${process.arch}`;
  const buildDir = join(repoRoot, "target");
  return [
    join(here, platformArch, file),
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
  // The zero-copy back-buffer view strides by CELL_BYTES; a layout drift here
  // would corrupt every cell read/write, so fail loud at load.
  const cellBytes = Number(lib.symbols.vui_cell_size_bytes());
  if (cellBytes !== CELL_BYTES) {
    throw new Error(
      `vui-core Cell size mismatch: native=${cellBytes}, expected=${CELL_BYTES}. ` +
        "Rebuild the native lib: bun run build:native",
    );
  }
  // The StyleFfi packer writes fields at fixed offsets; a size drift means the
  // packer and the native struct disagree on layout — corrupting every style.
  const styleBytes = Number(lib.symbols.vui_style_ffi_size());
  if (styleBytes !== STYLE_FFI_BYTES) {
    throw new Error(
      `vui-core StyleFfi size mismatch: native=${styleBytes}, expected=${STYLE_FFI_BYTES}. ` +
        "Rebuild the native lib: bun run build:native",
    );
  }
  cached = lib;
  return cached;
}
