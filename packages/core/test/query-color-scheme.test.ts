// OSC 11 background-color detection against a mock tty: a dark background resolves
// to 'dark', a light one to 'light', a non-reply times out to undefined, a non-TTY
// short-circuits, and — the cardinal guarantee — raw mode is restored to whatever
// it was before the query, so probing the terminal leaves it exactly as found.
import { describe, expect, test } from 'bun:test'
import { queryColorScheme, type QueryColorSchemeOptions } from '../src/query-color-scheme.ts'
import type { InputStream, OutputStream } from '../src/terminal-session.ts'

type Listener = (...args: unknown[]) => void

/** A mock stdin that can be told to auto-reply with an OSC 11 string on query. */
function mockInput(opts: { isTTY?: boolean; isRaw?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const rawModeCalls: boolean[] = []
  return {
    isTTY: opts.isTTY ?? true,
    isRaw: opts.isRaw ?? false,
    rawModeCalls,
    setRawMode(mode: boolean) {
      rawModeCalls.push(mode)
    },
    resume() {},
    on(event: string, cb: Listener) {
      ;(listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(cb)
    },
    off(event: string, cb: Listener) {
      listeners.get(event)?.delete(cb)
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
  } satisfies InputStream & Record<string, unknown>
}

/** A mock stdout that, when given a `reply`, feeds it back to the input on write. */
function mockOutput(input: ReturnType<typeof mockInput>, reply?: string) {
  return {
    write(_data: string) {
      if (reply !== undefined) input.emit('data', reply)
    },
    on() {},
    off() {},
  } satisfies OutputStream & Record<string, unknown>
}

function run(input: ReturnType<typeof mockInput>, reply?: string, over: Partial<QueryColorSchemeOptions> = {}) {
  return queryColorScheme({ input, output: mockOutput(input, reply), timeoutMs: 20, ...over })
}

describe('queryColorScheme', () => {
  test('a black background resolves to dark', async () => {
    const input = mockInput()
    expect(await run(input, '\x1b]11;rgb:0000/0000/0000\x07')).toBe('dark')
  })

  test('a white background resolves to light', async () => {
    const input = mockInput()
    expect(await run(input, '\x1b]11;rgb:ffff/ffff/ffff\x07')).toBe('light')
  })

  test('no reply times out to undefined', async () => {
    const input = mockInput()
    expect(await run(input)).toBeUndefined()
  })

  test('a non-TTY short-circuits to undefined without writing', async () => {
    const input = mockInput({ isTTY: false })
    expect(await run(input, '\x1b]11;rgb:ffff/ffff/ffff\x07')).toBeUndefined()
  })

  test('raw mode is restored to its prior value after the query', async () => {
    const input = mockInput({ isRaw: true })
    await run(input, '\x1b]11;rgb:0000/0000/0000\x07')
    // Toggled on for the probe, restored to the pre-query value (true) on finish.
    expect(input.rawModeCalls).toEqual([true, true])

    const input2 = mockInput({ isRaw: false })
    await run(input2, '\x1b]11;rgb:0000/0000/0000\x07')
    expect(input2.rawModeCalls).toEqual([true, false])
  })
})
