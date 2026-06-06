// Terminal session against a mock tty: it must enter raw/alt-screen on start,
// surface data + resize, and — the cardinal guarantee — restore EXACTLY ONCE no
// matter how many times teardown is invoked, leaving no raw/alt-screen state.
import { describe, expect, test } from 'bun:test'
import { createTerminalSession, type InputStream, type OutputStream } from '../src/terminal-session.ts'

type Listener = (...args: unknown[]) => void

function mockInput() {
  const listeners = new Map<string, Set<Listener>>()
  const rawModeCalls: boolean[] = []
  return {
    isTTY: true,
    rawModeCalls,
    setRawMode(mode: boolean) {
      rawModeCalls.push(mode)
    },
    resume() {},
    pause() {},
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

function mockOutput() {
  const listeners = new Map<string, Set<Listener>>()
  const writes: string[] = []
  return {
    columns: 80,
    rows: 24,
    writes,
    write(data: string) {
      writes.push(data)
    },
    on(event: string, cb: Listener) {
      ;(listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(cb)
    },
    off(event: string, cb: Listener) {
      listeners.get(event)?.delete(cb)
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
  } satisfies OutputStream & Record<string, unknown>
}

function session() {
  const input = mockInput()
  const output = mockOutput()
  const s = createTerminalSession({ input, output, installSignalHandlers: false })
  return { s, input, output }
}

describe('terminal session', () => {
  test('start enters raw mode + alt screen + hides cursor + enables paste and mouse', () => {
    const { s, input, output } = session()
    s.start()
    expect(input.rawModeCalls).toEqual([true])
    const all = output.writes.join('')
    expect(all).toContain('\x1b[?1049h') // alt screen
    expect(all).toContain('\x1b[?25l') // hide cursor
    expect(all).toContain('\x1b[?2004h') // bracketed paste on
    expect(all).toContain('\x1b[?1006h') // SGR mouse on
    expect(all).toContain('\x1b[?1000h') // button mouse on
    expect(all).toContain('\x1b[?1002h') // drag mouse on
    expect(all).toContain('\x1b[>1u') // kitty keyboard push (disambiguate)
    s.stop()
  })

  test('kitty keyboard is popped on stop, and skipped when disabled', () => {
    const { s, output } = session()
    s.start()
    s.stop()
    expect(output.writes.join('')).toContain('\x1b[<u') // pop on teardown

    const input2 = mockInput()
    const output2 = mockOutput()
    const s2 = createTerminalSession({
      input: input2,
      output: output2,
      installSignalHandlers: false,
      kittyKeyboard: false,
    })
    s2.start()
    s2.stop()
    const all2 = output2.writes.join('')
    expect(all2).not.toContain('\x1b[>1u')
    expect(all2).not.toContain('\x1b[<u')
  })

  test('data + resize are surfaced to callbacks', () => {
    const { s, input, output } = session()
    let got = ''
    let size: [number, number] | null = null
    s.onData((d) => {
      got += d
    })
    s.onResize((c, r) => {
      size = [c, r]
    })
    s.start()
    input.emit('data', 'hi')
    input.emit('data', new TextEncoder().encode('!')) // bytes decode too
    output.columns = 100
    output.rows = 30
    output.emit('resize')
    expect(got).toBe('hi!')
    expect(size).toEqual([100, 30])
    s.stop()
  })

  test('teardown restores exactly once and leaves no raw/alt-screen state', () => {
    const { s, input, output } = session()
    s.start()
    s.stop()
    s.stop() // idempotent: a second teardown is a no-op
    // setRawMode(false) happened exactly once.
    expect(input.rawModeCalls.filter((m) => m === false).length).toBe(1)
    const restores = output.writes.join('')
    // Each restore sequence appears exactly once.
    expect(restores.split('\x1b[?1049l').length - 1).toBe(1) // leave alt screen
    expect(restores.split('\x1b[?25h').length - 1).toBe(1) // show cursor
    expect(restores.split('\x1b[?2004l').length - 1).toBe(1) // paste off
    expect(restores.split('\x1b[?1006l').length - 1).toBe(1) // SGR mouse off
    expect(restores.split('\x1b[?1000l').length - 1).toBe(1) // button mouse off
    expect(restores.split('\x1b[?1002l').length - 1).toBe(1) // drag mouse off
  })

  test('data after stop is not delivered', () => {
    const { s, input } = session()
    let count = 0
    s.onData(() => {
      count += 1
    })
    s.start()
    s.stop()
    input.emit('data', 'x')
    expect(count).toBe(0)
  })
})
