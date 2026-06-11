import type { InputStream, OutputStream } from './terminal-session.ts'

const decoder = new TextDecoder()
const OSC11_QUERY = '\x1b]11;?\x07'
// OSC 11 reply: `…]11;rgb:RRRR/GGGG/BBBB` (BEL or ST terminated); 1–4 hex digits.
const REPLY = /\x1b\]11;rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/

export interface QueryColorSchemeOptions {
  input?: InputStream
  output?: OutputStream
  /** Give up after this long with no reply (default 100ms). */
  timeoutMs?: number
}

function frac(h: string): number {
  return Number.parseInt(h, 16) / ((1 << (h.length * 4)) - 1)
}

/** Query the terminal background color via OSC 11. `undefined` if non-TTY or no reply. */
export function queryBackgroundColor(
  options: QueryColorSchemeOptions = {},
): Promise<{ r: number; g: number; b: number } | undefined> {
  const input = options.input ?? (process.stdin as unknown as InputStream)
  const output = options.output ?? (process.stdout as unknown as OutputStream)
  const timeoutMs = options.timeoutMs ?? 100
  if (!input.isTTY) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const wasRaw = (input as { isRaw?: boolean }).isRaw === true
    let buf = ''
    let done = false
    const finish = (r?: { r: number; g: number; b: number }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      input.off('data', onData)
      input.setRawMode?.(wasRaw) // restore terminal exactly as found
      resolve(r)
    }
    const onData = (chunk: unknown): void => {
      buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array)
      const m = REPLY.exec(buf)
      if (m) finish({ r: frac(m[1]!), g: frac(m[2]!), b: frac(m[3]!) })
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    input.setRawMode?.(true)
    input.resume?.()
    input.on('data', onData)
    output.write(OSC11_QUERY)
  })
}

/** Detect light/dark by querying the terminal background (OSC 11) + luminance. */
export async function queryColorScheme(options: QueryColorSchemeOptions = {}): Promise<'dark' | 'light' | undefined> {
  const bg = await queryBackgroundColor(options)
  if (!bg) return undefined
  return 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b > 0.5 ? 'light' : 'dark'
}
