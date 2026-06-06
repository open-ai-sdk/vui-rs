// The raw-emit passthrough channel binds across FFI and is a no-op for empty
// input. Behavioral coverage (forces a frame, emits inside the sync wrapper,
// clears after) lives in the Rust renderer test; here we just assert the JS
// wrapper forwards without throwing and respects the empty-input fast path.
import { describe, expect, test } from 'bun:test'
import { Renderer } from '../src/index.ts'

describe('renderer passthrough channel', () => {
  test('stagePassthrough forwards bytes and clears after a flush', () => {
    const r = new Renderer(4, 1)
    try {
      // Empty input is a no-op (never reaches native).
      expect(() => r.stagePassthrough(new Uint8Array(0))).not.toThrow()
      // A real one-shot sequence stages + flushes without error.
      r.stagePassthrough(new TextEncoder().encode('\x1b]52;c;Zm9v\x07'))
      expect(() => r.flush()).not.toThrow()
      // Channel cleared: a second flush with nothing staged is also fine.
      expect(() => r.flush()).not.toThrow()
    } finally {
      r.free()
    }
  })
})
