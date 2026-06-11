#!/usr/bin/env bun
// Publish the @vui-rs/* packages to npm with `bun publish` (NOT `changeset
// publish` / `npm publish`): only `bun publish` strips and resolves the Bun
// `workspace:` and `catalog:` protocols in package.json at pack time, so the
// published manifests carry real version ranges instead of broken protocol
// strings.
//
// IMPORTANT: `bun publish` resolves a `workspace:*` dep to the version recorded
// in `bun.lock`, NOT the bumped `package.json` version. So `ci:version` must run
// `bun update` (NOT `bun install --lockfile-only`) after `changeset version` —
// otherwise an internal dep (e.g. @vui-rs/vue → @vui-rs/core) publishes pinned to
// the previous, stale version. See changesets/bun workspace-resolution issue.
//
// Runs after `changeset version` has bumped versions and `build:packages` has
// produced each `dist/` (incl. the cross-compiled native libs in
// `@vui-rs/core`). Idempotent: a version already on the registry is skipped, so a
// re-run after a partial failure resumes cleanly. Auth comes from the
// environment (NPM_CONFIG_TOKEN / ~/.npmrc), set up by the release workflow.
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')

// Dependency order: a package is published after the @vui-rs/* packages it
// depends on. The platform binary packages go first (core lists them as
// optionalDependencies), then core → vue → ui; vite-plugin is independent;
// rolldown depends on vite-plugin via `workspace:*`, so it publishes after it.
const PLATFORM_DIRS = ['core-darwin-arm64', 'core-darwin-x64', 'core-linux-x64', 'core-linux-arm64', 'core-win32-x64']
const DIRS = [...PLATFORM_DIRS, 'core', 'vue', 'ui', 'vite-plugin', 'rolldown']

/** A platform package must contain its binary, or it would publish empty. */
async function assertBinaryPresent(dir: string): Promise<void> {
  const pkg = await Bun.file(join(repoRoot, 'packages', dir, 'package.json')).json()
  const lib = (pkg.files as string[]).find((f) => /\.(dylib|so|dll)$/.test(f))
  if (!lib) throw new Error(`packages/${dir}: no binary listed in files[]`)
  if (!(await Bun.file(join(repoRoot, 'packages', dir, lib)).exists())) {
    console.error(`packages/${dir}/${lib} is missing — run \`bun run build:native:all\` first`)
    process.exit(1)
  }
}

interface Manifest {
  name: string
  version: string
  private?: boolean
}

async function alreadyPublished(name: string, version: string): Promise<boolean> {
  // `npm view` is available on the CI runner (Node ships with it). A 404 (version
  // not found) exits non-zero → treat as "not published".
  const proc = Bun.spawn(['npm', 'view', `${name}@${version}`, 'version'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  return out === version
}

async function publish(dir: string): Promise<void> {
  const cwd = join(repoRoot, 'packages', dir)
  const proc = Bun.spawn(['bun', 'publish', '--access', 'public'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`\nbun publish failed for packages/${dir} (exit ${code})`)
    process.exit(code)
  }
}

for (const dir of DIRS) {
  const pkg: Manifest = await Bun.file(join(repoRoot, 'packages', dir, 'package.json')).json()
  if (pkg.private) {
    console.log(`skip ${pkg.name} (private)`)
    continue
  }
  if (await alreadyPublished(pkg.name, pkg.version)) {
    console.log(`skip ${pkg.name}@${pkg.version} (already on npm)`)
    continue
  }
  if (PLATFORM_DIRS.includes(dir)) await assertBinaryPresent(dir)
  console.log(`publishing ${pkg.name}@${pkg.version} …`)
  await publish(dir)
}

console.log('done.')
