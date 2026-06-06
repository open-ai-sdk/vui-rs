#!/usr/bin/env bun
// Publish the @vui-rs/* packages to npm with `bun publish` (NOT `changeset
// publish` / `npm publish`): only `bun publish` strips and resolves the Bun
// `workspace:` and `catalog:` protocols in package.json at pack time, so the
// published manifests carry real version ranges instead of broken protocol
// strings.
//
// Runs after `changeset version` has bumped versions and `build:packages` has
// produced each `dist/` (incl. the cross-compiled native libs in
// `@vui-rs/core`). Idempotent: a version already on the registry is skipped, so a
// re-run after a partial failure resumes cleanly. Auth comes from the
// environment (NPM_CONFIG_TOKEN / ~/.npmrc), set up by the release workflow.
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')

// Dependency order: a package is published after the @vui-rs/* packages it
// depends on (core → vue → ui; vite-plugin is independent).
const DIRS = ['core', 'vue', 'ui', 'vite-plugin']

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
  console.log(`publishing ${pkg.name}@${pkg.version} …`)
  await publish(dir)
}

console.log('done.')
