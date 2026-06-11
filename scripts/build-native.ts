#!/usr/bin/env bun
// Builds crates/vui-core and copies the cdylib into the platform-specific npm
// package (`packages/core-<platform>-<arch>/`), published alongside
// @vui-rs/core and resolved by the FFI loader at runtime.
//
//   bun run scripts/build-native.ts                 # host build (cargo), release
//   bun run scripts/build-native.ts --debug         # host build, debug profile
//   bun run scripts/build-native.ts --target <triple>   # cross-compile one target (cargo-zigbuild)
//   bun run scripts/build-native.ts --all           # cross-compile every release target
//
// Cross targets use `cargo zigbuild` (zig as the linker) so all platforms build
// from one runner — see .github/workflows/release.yml. The host path uses plain
// `cargo build` so local dev needs no extra toolchain.
import { suffix } from 'bun:ffi'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A cross-compile target: Rust triple → npm `<platform>-<arch>` dir + cdylib filename. */
interface Target {
  triple: string
  platformArch: string
  file: string
}

// The published platform set. cdylib filenames match what the runtime loader
// expects on each platform (prefix `lib` except Windows; ext per OS).
const TARGETS: Target[] = [
  { triple: 'aarch64-apple-darwin', platformArch: 'darwin-arm64', file: 'libvui_core.dylib' },
  { triple: 'x86_64-apple-darwin', platformArch: 'darwin-x64', file: 'libvui_core.dylib' },
  { triple: 'x86_64-unknown-linux-gnu', platformArch: 'linux-x64', file: 'libvui_core.so' },
  { triple: 'aarch64-unknown-linux-gnu', platformArch: 'linux-arm64', file: 'libvui_core.so' },
  { triple: 'x86_64-pc-windows-gnu', platformArch: 'win32-x64', file: 'vui_core.dll' },
]

const args = process.argv.slice(2)
const debug = args.includes('--debug')
const all = args.includes('--all')
const explicitTargets: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target' && args[i + 1]) explicitTargets.push(args[++i]!)
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`\ncommand failed (${code}): ${cmd.join(' ')}`)
    process.exit(code)
  }
}

function copyArtifact(builtPath: string, platformArch: string, file: string): void {
  if (!existsSync(builtPath)) throw new Error(`expected build artifact missing: ${builtPath}`)
  const destDir = join(repoRoot, 'packages', `core-${platformArch}`)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(builtPath, join(destDir, file))
  console.log(`vui-core -> ${join(`packages/core-${platformArch}`, file)}`)
}

/** Cross-compile one target with cargo-zigbuild and copy its cdylib into place. */
async function buildTarget(t: Target): Promise<void> {
  await run(['cargo', 'zigbuild', '-p', 'vui-core', '--release', '--target', t.triple])
  copyArtifact(join(repoRoot, 'target', t.triple, 'release', t.file), t.platformArch, t.file)
}

/** Host build with plain cargo (no cross toolchain needed for local dev). */
async function buildHost(): Promise<void> {
  const profile = debug ? 'debug' : 'release'
  const cargoArgs = ['build', '-p', 'vui-core']
  if (!debug) cargoArgs.push('--release')
  await run(['cargo', ...cargoArgs])
  const prefix = process.platform === 'win32' ? '' : 'lib'
  const file = `${prefix}vui_core.${suffix}`
  copyArtifact(join(repoRoot, 'target', profile, file), `${process.platform}-${process.arch}`, file)
}

const selected = all
  ? TARGETS
  : explicitTargets.map((triple) => {
      const t = TARGETS.find((x) => x.triple === triple)
      if (!t) throw new Error(`unknown --target ${triple}; known: ${TARGETS.map((x) => x.triple).join(', ')}`)
      return t
    })

if (selected.length === 0) {
  await buildHost()
} else {
  for (const t of selected) await buildTarget(t)
}
