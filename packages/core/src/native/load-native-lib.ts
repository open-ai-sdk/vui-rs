import { dlopen, suffix } from "bun:ffi";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CELL_BYTES, EXPECTED_ABI_VERSION, STYLE_FFI_BYTES, symbols } from "./ffi-symbols.ts";
import { resolveNativePackage, resolveNativePackageSync } from "./native-package.ts";

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
 * Resolve the per-user cache directory for extracted native libs.
 *
 * Uses $XDG_CACHE_HOME/vui-rs on XDG-compliant systems (most Linux), or
 * ~/.cache/vui-rs on macOS/Linux, or a pid-isolated subdir under the system
 * temp dir as a last resort (e.g. restricted environments without a home dir).
 * The directory is created with mode 0700 so other users on a shared machine
 * cannot read or replace extracted binaries.
 */
function userCacheDir(): string {
  const xdg = process.env["XDG_CACHE_HOME"];
  if (xdg) return join(xdg, "vui-rs");
  try {
    return join(homedir(), ".cache", "vui-rs");
  } catch {
    // homedir() can throw in sandboxed/container environments.
    return join(tmpdir(), `vui-rs-${process.env["USER"] ?? "ffi"}`);
  }
}

/**
 * When running inside a `bun build --compile` binary the OS dynamic linker
 * cannot open virtual `$bunfs` paths — they live in Bun's in-process VFS, not
 * on the real filesystem. Copy the embedded bytes to a versioned cache file
 * in the user's private cache directory so `dlopen(2)` gets a real path.
 *
 * Detection: `$bunfs` virtual paths contain the literal substring "bunfs".
 * Real dev/npm paths never do, so the check is a zero-cost no-op outside a
 * compiled binary.
 *
 * Security model:
 * - Cache directory is created with mode 0700 (user-only) so other users on a
 *   shared machine cannot plant or replace the extracted lib.
 * - On cache hit the full file content is hashed and compared against the
 *   embedded bytes before returning the path. A mismatching file is overwritten
 *   rather than used, guarding against stale content from a previous binary.
 * - Writes go to a temp file (`<out>.<pid>.tmp`) then atomically renamed into
 *   place so a crash mid-write leaves only the temp file, never a truncated
 *   cached path that `existsSync` would reuse.
 * - On Windows `renameSync` over an existing file succeeds (Node.js handles the
 *   EPERM/EEXIST by falling back to copy+delete internally since Node 12).
 */
export function extractEmbeddedLib(path: string): string {
  if (!path.includes("bunfs")) return path;

  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);

  const name = basename(path);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const cachedName = `${stem}-${hash}${ext}`;

  const cacheDir = userCacheDir();
  const out = join(cacheDir, cachedName);

  if (existsSync(out)) {
    // Verify content matches embedded bytes before trusting the cached file.
    // Guards against partial writes from a previous crash or a planted file.
    const existing = readFileSync(out);
    const existingHash = createHash("sha256").update(existing).digest("hex").slice(0, 16);
    if (existingHash === hash) return out;
    // Hash mismatch — fall through to overwrite.
  }

  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  // On Unix: tighten permissions if the dir already existed without 0700.
  if (process.platform !== "win32") {
    try { chmodSync(cacheDir, 0o700); } catch { /* best-effort */ }
  }

  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o755 });
  try {
    renameSync(tmp, out);
  } catch {
    // On Windows, renameSync may fail if another process holds the target open
    // (e.g. two processes starting simultaneously). The EEXIST case is safe to
    // ignore if the target now exists with verified content.
    if (existsSync(out)) {
      try {
        const existing = readFileSync(out);
        const existingHash = createHash("sha256").update(existing).digest("hex").slice(0, 16);
        if (existingHash === hash) return out;
      } catch { /* fall through */ }
    }
    // Last resort: leave the tmp file in place and return it directly.
    return tmp;
  }

  return out;
}

/**
 * Library lookup order (the newest existing candidate actually wins — see
 * `loadNativeLib`):
 *  1. Platform npm package `@vui-rs/core-<platform>-<arch>` resolved through
 *     node_modules — the path that exists for npm installs and for the
 *     workspace dev checkout after `bun install`.
 *  2. Dev: the platform package dir reached relatively from this file
 *     (`packages/core-<platform>-<arch>/`), covering checkouts where the
 *     workspace links are not installed yet.
 *  3. Dev fallbacks: the cargo workspace build directory (release, then debug).
 *
 * `here` is `<pkg>/src/native` in dev and `<pkg>/dist/native` in a build — both
 * sit at the same depth, so the relative joins resolve correctly either way.
 */
function candidatePaths(): string[] {
  const file = libFileName();
  const platformArch = `${process.platform}-${process.arch}`;
  const buildDir = join(repoRoot, "target");
  const fromPackage = resolveNativePackageSync(file);
  return [
    ...(fromPackage ? [fromPackage] : []),
    join(here, "..", "..", "..", `core-${platformArch}`, file),
    join(buildDir, "release", file),
    join(buildDir, "debug", file),
  ];
}

function open(path: string) {
  return dlopen(extractEmbeddedLib(path), symbols);
}

export type NativeLib = ReturnType<typeof open>;

let cached: NativeLib | undefined;

/**
 * Resolve, `dlopen`, ABI-check, and memoize the vui-core native library.
 *
 * When several candidates exist (e.g. a debug build alongside a stale release
 * copy) the most recently modified one wins, so a fresh `cargo build` always
 * takes precedence over an old artifact during iterative development.
 *
 * If no filesystem candidate is found, falls back to importing the platform
 * npm package, which inside `bun build --compile` binaries surfaces the
 * embedded dylib (a $bunfs path). That path then goes through the normal
 * extractEmbeddedLib → dlopen flow.
 */
export async function loadNativeLibAsync(): Promise<NativeLib> {
  if (cached) return cached;
  const candidates = candidatePaths();
  const existing = candidates.filter((p) => existsSync(p));

  let path: string | null = null;
  if (existing.length > 0) {
    path = existing.reduce((newest, p) =>
      statSync(p).mtimeMs > statSync(newest).mtimeMs ? p : newest,
    );
  } else {
    // No filesystem candidate — import the platform package (inside a compiled
    // binary this surfaces the embedded binary as a $bunfs path; in a plain
    // runtime it covers resolution setups Bun.resolveSync missed).
    const fromPackage = await resolveNativePackage();
    if (fromPackage != null) {
      path = fromPackage;
    } else {
      throw new Error(
        "vui-core native library not found. Searched:\n" +
          candidates.map((p) => `  - ${p}`).join("\n") +
          `\n  - @vui-rs/core-${process.platform}-${process.arch}: not installed` +
          "\nBuild it with: bun run build:native",
      );
    }
  }

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

/**
 * Synchronous wrapper retained for backwards-compatibility with callers that
 * cannot be made async. In dev/npm environments all candidates are filesystem
 * paths and no async work is needed; the async path (embedded lib) is only
 * reached inside a compiled binary where the dynamic import resolves instantly
 * from the in-process VFS.
 *
 * If the embedded fallback is needed and the caller is synchronous, this
 * function throws with a clear message directing the caller to use
 * `loadNativeLibAsync()` instead.
 */
export function loadNativeLib(): NativeLib {
  if (cached) return cached;
  const candidates = candidatePaths();
  const existing = candidates.filter((p) => existsSync(p));
  if (existing.length === 0) {
    throw new Error(
      "vui-core native library not found. Searched:\n" +
        candidates.map((p) => `  - ${p}`).join("\n") +
        `\n  - @vui-rs/core-${process.platform}-${process.arch} (embedded/compiled): use loadNativeLibAsync() to reach this path` +
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
  const cellBytes = Number(lib.symbols.vui_cell_size_bytes());
  if (cellBytes !== CELL_BYTES) {
    throw new Error(
      `vui-core Cell size mismatch: native=${cellBytes}, expected=${CELL_BYTES}. ` +
        "Rebuild the native lib: bun run build:native",
    );
  }
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
