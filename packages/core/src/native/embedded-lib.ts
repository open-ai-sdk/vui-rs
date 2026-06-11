/**
 * Embedded-library resolver for `bun build --compile` artifacts.
 *
 * Each conditional branch uses a STATIC string literal specifier with
 * `with { type: "file" }` so that when a consumer runs:
 *
 *   bun build --compile --target=bun-darwin-arm64 ...
 *
 * Bun's bundler sees the literal import for the target platform, inlines the
 * dylib bytes into the binary's virtual filesystem ($bunfs), and dead-code-
 * eliminates all other branches. The result: only the target platform's lib
 * is embedded.
 *
 * Specifiers are relative to THIS file's compiled location (dist/native/).
 * tsdown unbundle mode mirrors the src tree at the same depth:
 *   src/native/embedded-lib.ts  → dist/native/embedded-lib.js
 * The tsdown copy step places prebuilt libs at dist/native/<platform>-<arch>/,
 * so from dist/native/ the correct relative specifier is ./darwin-arm64/...
 *
 * Each branch is wrapped in try/catch returning null so dev checkouts (where
 * only the host arch lib exists) do not throw — filesystem candidates in
 * candidatePaths() satisfy those environments before this fallback is reached.
 */
export async function resolveEmbeddedLib(): Promise<string | null> {
  if (process.platform === "darwin" && process.arch === "arm64") {
    try {
      return (await import("./darwin-arm64/libvui_core.dylib", { with: { type: "file" } })).default
    } catch { return null }
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    try {
      return (await import("./darwin-x64/libvui_core.dylib", { with: { type: "file" } })).default
    } catch { return null }
  }
  if (process.platform === "linux" && process.arch === "x64") {
    try {
      return (await import("./linux-x64/libvui_core.so", { with: { type: "file" } })).default
    } catch { return null }
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    try {
      return (await import("./linux-arm64/libvui_core.so", { with: { type: "file" } })).default
    } catch { return null }
  }
  if (process.platform === "win32" && process.arch === "x64") {
    try {
      return (await import("./win32-x64/vui_core.dll", { with: { type: "file" } })).default
    } catch { return null }
  }
  return null
}
