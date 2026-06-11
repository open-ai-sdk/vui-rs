import { dirname, join } from "node:path";

/**
 * Resolve the prebuilt vui-core cdylib from the platform-specific npm package
 * (`@vui-rs/core-<platform>-<arch>`):
 * each platform package carries one binary plus an index.js that exports its
 * path via a `with { type: "file" }` import.
 *
 * Why conditional dynamic imports with literal specifiers: when a consumer runs
 * `bun build --compile --target=...`, Bun inlines `process.platform` /
 * `process.arch`, dead-code-eliminates every non-target branch, follows the one
 * remaining import into the platform package, and embeds that single binary in
 * the executable's virtual filesystem ($bunfs). In a plain runtime the import
 * resolves to the real file inside node_modules.
 *
 * Each branch is wrapped in try/catch returning null: the platform package may
 * legitimately be absent (npm skips optionalDependencies whose os/cpu fields
 * do not match, dev checkouts resolve from the cargo target dir instead).
 */
export async function resolveNativePackage(): Promise<string | null> {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      try {
        return (await import("@vui-rs/core-darwin-arm64")).default;
      } catch {
        return null;
      }
    }
    if (process.arch === "x64") {
      try {
        return (await import("@vui-rs/core-darwin-x64")).default;
      } catch {
        return null;
      }
    }
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") {
      try {
        return (await import("@vui-rs/core-linux-x64")).default;
      } catch {
        return null;
      }
    }
    if (process.arch === "arm64") {
      try {
        return (await import("@vui-rs/core-linux-arm64")).default;
      } catch {
        return null;
      }
    }
  }
  if (process.platform === "win32" && process.arch === "x64") {
    try {
      return (await import("@vui-rs/core-win32-x64")).default;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Synchronous resolution of the platform package's binary, for the sync
 * `loadNativeLib()` path. `Bun.resolveSync` finds the package's index.js
 * through normal node_modules resolution; the binary sits next to it. Returns
 * null when the package is not installed (and inside compiled binaries, where
 * the embedded binary is not "next to" the virtual index.js — the async
 * import above is the route there).
 */
export function resolveNativePackageSync(libFileName: string): string | null {
  const pkg = `@vui-rs/core-${process.platform}-${process.arch}`;
  try {
    const indexPath = Bun.resolveSync(pkg, import.meta.dir);
    return join(dirname(indexPath), libFileName);
  } catch {
    return null;
  }
}
