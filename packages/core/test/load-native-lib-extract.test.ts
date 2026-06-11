import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { extractEmbeddedLib } from '../src/native/load-native-lib.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expected per-user cache root (mirrors the logic in load-native-lib.ts). */
function expectedCacheDir(): string {
  const xdg = process.env['XDG_CACHE_HOME']
  if (xdg) return join(xdg, 'vui-rs')
  try {
    return join(homedir(), '.cache', 'vui-rs')
  } catch {
    /**/
  }
  return join(tmpdir(), `vui-rs-${process.env['USER'] ?? 'ffi'}`)
}

// ---------------------------------------------------------------------------
// Pass-through: non-bunfs paths are returned unchanged
// ---------------------------------------------------------------------------

describe('extractEmbeddedLib — pass-through', () => {
  it("returns the same path when it does not contain 'bunfs'", () => {
    const devPath = '/some/real/path/libvui_core.dylib'
    expect(extractEmbeddedLib(devPath)).toBe(devPath)
  })

  it('returns the same path for a cargo target dir path', () => {
    const cargoPath = '/home/user/repo/target/release/libvui_core.dylib'
    expect(extractEmbeddedLib(cargoPath)).toBe(cargoPath)
  })

  it('returns the same path for a node_modules npm dist path', () => {
    const npmPath = '/home/user/project/node_modules/@vui-rs/core/dist/native/linux-x64/libvui_core.so'
    expect(extractEmbeddedLib(npmPath)).toBe(npmPath)
  })

  it('returns the same path for a Windows dll path', () => {
    const winPath = 'C:\\Users\\user\\node_modules\\@vui-rs\\core\\dist\\native\\win32-x64\\vui_core.dll'
    expect(extractEmbeddedLib(winPath)).toBe(winPath)
  })
})

// ---------------------------------------------------------------------------
// Extraction: paths containing 'bunfs' trigger copy to per-user cache dir
// ---------------------------------------------------------------------------

describe('extractEmbeddedLib — bunfs extraction', () => {
  // Build a fake source file whose path contains 'bunfs' by placing it in a
  // temp directory with 'bunfs' in the path.
  const fakeBunfsDir = join(tmpdir(), 'bunfs-test-source')
  const fakeLibName = 'libvui_core.dylib'
  const fakeBunfsPath = join(fakeBunfsDir, fakeLibName)
  const fakeContent = Buffer.from('fake-dylib-bytes-for-unit-test')

  it('copies the embedded file to the per-user vui-rs cache dir', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)

    expect(result).not.toBe(fakeBunfsPath)
    // Result must live under the per-user cache dir (not the shared tmp root).
    expect(result.startsWith(expectedCacheDir())).toBe(true)
    expect(existsSync(result)).toBe(true)
    expect(readFileSync(result)).toEqual(fakeContent)

    // Cleanup
    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })

  it('is idempotent: calling twice with identical bytes returns the same cache path', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result1 = extractEmbeddedLib(fakeBunfsPath)
    const result2 = extractEmbeddedLib(fakeBunfsPath)

    expect(result2).toBe(result1)
    expect(existsSync(result1)).toBe(true)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result1, { force: true })
  })

  it('writes a new cache file when content changes (different hash in filename)', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })

    const contentA = Buffer.from('version-A-bytes')
    const contentB = Buffer.from('version-B-bytes-different')

    writeFileSync(fakeBunfsPath, contentA)
    const resultA = extractEmbeddedLib(fakeBunfsPath)

    writeFileSync(fakeBunfsPath, contentB)
    const resultB = extractEmbeddedLib(fakeBunfsPath)

    expect(resultA).not.toBe(resultB)
    expect(existsSync(resultA)).toBe(true)
    expect(existsSync(resultB)).toBe(true)
    expect(readFileSync(resultA)).toEqual(contentA)
    expect(readFileSync(resultB)).toEqual(contentB)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(resultA, { force: true })
    rmSync(resultB, { force: true })
  })

  it('cache filename includes the stem and extension of the original lib', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)
    const cacheName = result.split('/').at(-1)!

    expect(cacheName.startsWith('libvui_core-')).toBe(true)
    expect(cacheName.endsWith('.dylib')).toBe(true)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })

  it('uses full-content hash: same first-4KiB but different tail produces different cache path', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })

    // Two buffers that share the first 4 KiB but differ in byte 4097+.
    const header = Buffer.alloc(4096, 0x42)
    const tailA = Buffer.from([0xaa, 0xbb])
    const tailB = Buffer.from([0xcc, 0xdd])
    const contentA = Buffer.concat([header, tailA])
    const contentB = Buffer.concat([header, tailB])

    writeFileSync(fakeBunfsPath, contentA)
    const resultA = extractEmbeddedLib(fakeBunfsPath)

    writeFileSync(fakeBunfsPath, contentB)
    const resultB = extractEmbeddedLib(fakeBunfsPath)

    // Full-content hash must distinguish them even though header is identical.
    expect(resultA).not.toBe(resultB)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(resultA, { force: true })
    rmSync(resultB, { force: true })
  })

  it('overwrites a corrupted cache file on content-hash mismatch', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    // Prime the cache.
    const result = extractEmbeddedLib(fakeBunfsPath)
    expect(existsSync(result)).toBe(true)

    // Corrupt the cached file in-place (different bytes, same name).
    writeFileSync(result, Buffer.from('corrupted-bytes'))

    // Re-extract — should detect the hash mismatch and overwrite.
    const result2 = extractEmbeddedLib(fakeBunfsPath)
    expect(result2).toBe(result)
    expect(readFileSync(result2)).toEqual(fakeContent)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })

  it('does not leave a .tmp file after a successful write', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)
    const cacheDir = expectedCacheDir()

    // No .tmp files should remain after extraction.
    const tmpFiles = existsSync(cacheDir)
      ? require('node:fs')
          .readdirSync(cacheDir)
          .filter((f: string) => f.endsWith('.tmp'))
      : []
    expect(tmpFiles.length).toBe(0)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })

  it('cache dir is NOT the shared system tmpdir root', () => {
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)

    // The cache path must not sit directly in tmpdir() — it must be in a
    // user-scoped subdir to avoid the shared-tmp security issue.
    const sharedTmpRoot = tmpdir()
    const parentDir = result.split('/').slice(0, -1).join('/')
    expect(parentDir).not.toBe(sharedTmpRoot)

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })

  it('cache dir has mode 0700 on Unix', () => {
    if (process.platform === 'win32') return // chmod semantics don't apply

    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)
    const cacheDir = expectedCacheDir()

    if (existsSync(cacheDir)) {
      const mode = statSync(cacheDir).mode & 0o777
      expect(mode).toBe(0o700)
    }

    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })
})
