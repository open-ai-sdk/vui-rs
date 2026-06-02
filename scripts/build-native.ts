#!/usr/bin/env bun
// Builds crates/vui-core and copies the cdylib to a stable, platform-scoped
// location the FFI loader can resolve without knowing the cargo profile.
//
//   bun run scripts/build-native.ts            # release (default)
//   bun run scripts/build-native.ts --debug    # debug profile
import { suffix } from "bun:ffi";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";

const cargoArgs = ["build", "-p", "vui-core"];
if (!debug) cargoArgs.push("--release");

const build = Bun.spawn(["cargo", ...cargoArgs], {
  cwd: repoRoot,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await build.exited;
if (code !== 0) process.exit(code);

const prefix = process.platform === "win32" ? "" : "lib";
const file = `${prefix}vui_core.${suffix}`;
const built = join(repoRoot, "target", profile, file);
if (!existsSync(built)) {
  throw new Error(`expected build artifact missing: ${built}`);
}

const destDir = join(
  repoRoot,
  "packages",
  "core",
  "native",
  `${process.platform}-${process.arch}`,
);
mkdirSync(destDir, { recursive: true });
copyFileSync(built, join(destDir, file));
console.log(`vui-core (${profile}) -> ${join(destDir, file)}`);
