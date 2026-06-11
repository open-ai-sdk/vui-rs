import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractEmbeddedLib } from '../src/native/load-native-lib.ts'

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
// Extraction: paths containing 'bunfs' trigger copy to cache dir
// ---------------------------------------------------------------------------

describe('extractEmbeddedLib — bunfs extraction', () => {
  // Build a fake source file whose path contains 'bunfs' by placing it in a
  // temp directory with 'bunfs' in the path.
  const fakeBunfsDir = join(tmpdir(), 'bunfs-test-source')
  const fakeLibName = 'libvui_core.dylib'
  const fakeBunfsPath = join(fakeBunfsDir, fakeLibName)
  const fakeContent = Buffer.from('fake-dylib-bytes-for-unit-test')

  it('copies the embedded file to the vui-rs-ffi-cache dir', () => {
    // Set up fake source
    mkdirSync(fakeBunfsDir, { recursive: true })
    writeFileSync(fakeBunfsPath, fakeContent)

    const result = extractEmbeddedLib(fakeBunfsPath)

    // Result must differ from the input (it now points at the cache)
    expect(result).not.toBe(fakeBunfsPath)
    // Result must live under tmpdir/vui-rs-ffi-cache
    expect(result.startsWith(join(tmpdir(), 'vui-rs-ffi-cache'))).toBe(true)
    // Cache file must exist and have the same bytes
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

    // Same content → same versioned filename both times
    expect(result2).toBe(result1)
    expect(existsSync(result1)).toBe(true)

    // Cleanup
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

    // Different content → different versioned filename
    expect(resultA).not.toBe(resultB)
    expect(existsSync(resultA)).toBe(true)
    expect(existsSync(resultB)).toBe(true)
    expect(readFileSync(resultA)).toEqual(contentA)
    expect(readFileSync(resultB)).toEqual(contentB)

    // Cleanup
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

    // Cleanup
    rmSync(fakeBunfsDir, { recursive: true, force: true })
    rmSync(result, { force: true })
  })
})
