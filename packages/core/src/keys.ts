// Byte-chunk → key-event parser. A raw-mode stdin chunk decodes to a
// string here and is scanned into discrete `KeyEvent`s (printables, named keys,
// modifiers) and `PasteEvent`s (bracketed paste). Paste content is captured
// literally and never re-parsed as keys/escapes — the anti-injection guarantee.
//
// v0 covers the common terminal set: printables, Enter/Tab/Shift-Tab/Backspace/
// Delete, arrows, Home/End/Insert/PageUp/PageDown, Esc, Ctrl-letter, Alt-letter,
// and SS3 F1–F4. `parseKeys` is stateless (one chunk in, events out). For live
// input where an escape sequence or a large bracketed paste can split across
// reads, use `createKeyDecoder`, which buffers a partial trailing sequence until
// the rest arrives. Kitty keyboard protocol (`CSI <code>;<mods> u`) is decoded
// alongside the legacy set, so disambiguated keys (e.g. Shift+Enter) parse when
// the terminal enables the protocol; terminals without it never emit CSI-u.

const decoder = new TextDecoder()

export interface KeyEvent {
  type: 'key'
  /** Lowercase name: a printable (`"a"`, `"世"`) or a named key (`"enter"`, `"up"`). */
  name: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  /** The exact source bytes (as a string) this event was parsed from. */
  raw: string
}

export interface PasteEvent {
  type: 'paste'
  text: string
}

export type MouseButton = 'left' | 'middle' | 'right' | 'wheelUp' | 'wheelDown'

export interface MouseEvent {
  type: 'mouse'
  kind: 'down' | 'up' | 'move' | 'drag' | 'wheel'
  button: MouseButton | null
  x: number
  y: number
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  raw: string
}

export interface ThemeEvent {
  type: 'theme'
  mode: 'dark' | 'light'
  raw: string
}

export type InputEvent = KeyEvent | PasteEvent | MouseEvent | ThemeEvent

interface Mods {
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  raw?: string
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const

const ARROW_NAMES: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }
const TILDE_NAMES: Record<string, string> = {
  '1': 'home',
  '2': 'insert',
  '3': 'delete',
  '4': 'end',
  '5': 'pageUp',
  '6': 'pageDown',
  '7': 'home',
  '8': 'end',
}
const SS3_NAMES: Record<string, string> = { ...ARROW_NAMES, P: 'f1', Q: 'f2', R: 'f3', S: 'f4' }

function key(name: string, opts: Mods = {}): KeyEvent {
  return {
    type: 'key',
    name,
    ctrl: !!opts.ctrl,
    alt: !!opts.alt,
    shift: !!opts.shift,
    meta: !!opts.meta,
    raw: opts.raw ?? name,
  }
}

/** Decode a CSI modifier param (`m` in `1;m`) into modifier flags. */
function decodeMod(param?: string): Mods {
  const m = param ? Number.parseInt(param, 10) - 1 : 0
  return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4), meta: !!(m & 8) }
}

/**
 * Kitty keyboard protocol functional keycodes that map to a named key. The
 * protocol reports most printable keys by their Unicode codepoint (handled
 * below) and reserves these specific codepoints for named keys. Arrows, Home/
 * End, etc. keep their legacy `CSI letter`/`CSI ~` encodings even in Kitty mode,
 * so they continue through the existing decoder and aren't listed here.
 */
const KITTY_NAMED: Record<number, string> = {
  13: 'enter',
  27: 'escape',
  9: 'tab',
  127: 'backspace',
  32: 'space',
}

/**
 * Decode a Kitty modifier+event field (`mods` or `mods:event-type`). The modifier
 * bitfield is value-minus-1; bit layout: shift1 alt2 ctrl4 super8 hyper16 meta32.
 * `super`/`meta` both fold to our `meta` flag. Event type: 1 press, 2 repeat, 3
 * release (default 1 when absent).
 */
function decodeKittyMod(param?: string): { mods: Mods; eventType: number } {
  const [modStr, evStr] = (param ?? '').split(':')
  const m = modStr ? Number.parseInt(modStr, 10) - 1 : 0
  const eventType = evStr ? Number.parseInt(evStr, 10) : 1
  return {
    mods: {
      shift: !!(m & 1),
      alt: !!(m & 2),
      ctrl: !!(m & 4),
      meta: !!(m & 8) || !!(m & 32),
    },
    eventType,
  }
}

/**
 * Decode a Kitty keyboard `CSI <code>[:alt:base] ; <mods>[:event] u` sequence into
 * a KeyEvent. Key releases (event type 3) are dropped in v0; repeats (2) fire as a
 * normal press. Malformed/unmapped control keycodes are consumed silently.
 */
function parseCsiU(params: string, raw: string, consumed: number, out: InputEvent[]): number {
  const parts = params.split(';')
  const keycode = Number.parseInt(parts[0]!.split(':')[0] ?? '', 10)
  if (!Number.isFinite(keycode)) return consumed // malformed: consume, emit nothing
  const { mods, eventType } = decodeKittyMod(parts[1])
  if (eventType === 3) return consumed // key release: ignore in v0
  let name = KITTY_NAMED[keycode]
  if (name === undefined) {
    if (keycode >= 0x20 && keycode !== 0x7f) name = String.fromCodePoint(keycode)
    else return consumed // unmapped control keycode
  }
  out.push(key(name, { ...mods, raw }))
  return consumed
}

/**
 * Parse one token at `i` into `out`, returning the bytes consumed. `-1` means a
 * truncated escape/paste sequence that needs more input (the caller decides
 * whether to buffer it or flush best-effort).
 */
interface MouseState {
  buttons: Set<MouseButton>
}

function newMouseState(): MouseState {
  return { buttons: new Set() }
}

function stepOne(s: string, i: number, out: InputEvent[], mouse: MouseState): number {
  const code = s.charCodeAt(i)
  if (code === 0x1b) {
    const r = parseEscape(s, i, out, mouse)
    if (r !== 0) return r // >0 consumed, or -1 incomplete
    out.push(key('escape', { raw: '\x1b' }))
    return 1
  }
  if (code === 0x0d || code === 0x0a) {
    out.push(key('enter', { raw: s[i]! }))
  } else if (code === 0x09) {
    out.push(key('tab', { raw: s[i]! }))
  } else if (code === 0x7f || code === 0x08) {
    out.push(key('backspace', { raw: s[i]! }))
  } else if (code === 0x00) {
    out.push(key('space', { ctrl: true, raw: s[i]! }))
  } else if (code >= 0x01 && code <= 0x1a) {
    out.push(key(String.fromCharCode(code + 0x60), { ctrl: true, raw: s[i]! }))
  } else if (code >= 0x1c && code <= 0x1f) {
    // Rare C0 controls (FS/GS/RS/US): consume, no event.
  } else {
    const ch = String.fromCodePoint(s.codePointAt(i)!)
    out.push(key(ch, { raw: ch, shift: ch.length === 1 && ch >= 'A' && ch <= 'Z' }))
    return ch.length
  }
  return 1
}

/** Parse a chunk of terminal input into discrete key/paste events (stateless). */
export function parseKeys(data: string | Uint8Array): InputEvent[] {
  const s = typeof data === 'string' ? data : decoder.decode(data)
  const events: InputEvent[] = []
  const mouse = newMouseState()
  let i = 0
  while (i < s.length) {
    const consumed = stepOne(s, i, events, mouse)
    if (consumed === -1) {
      // No more input coming (stateless): flush a truncated ESC as a bare Escape
      // and re-scan the remainder rather than dropping it.
      events.push(key('escape', { raw: '\x1b' }))
      i += 1
    } else {
      i += consumed
    }
  }
  return events
}

/** A bare partial CSI/SS3 (no terminator) buffered this long is treated as stuck
 *  and flushed, so a malformed stream can't grow the pending buffer unbounded. A
 *  bracketed paste (identified by its start marker) is exempt — pastes are large
 *  by nature and must buffer until their end marker. */
const MAX_PENDING = 64

export interface KeyDecoder {
  /** Feed a chunk; returns the events decodable so far. Buffers a partial tail. */
  feed(data: string | Uint8Array): InputEvent[]
  /**
   * Force-parse the buffered partial tail (best-effort: a lone ESC becomes a bare
   * Escape) and clear it. Call on an idle/escape timeout so a standalone Escape
   * keypress — indistinguishable from the start of a CSI/SS3 sequence until more
   * bytes arrive — isn't held until the next key. No-op when nothing is pending.
   */
  flush(): InputEvent[]
  /** The currently-buffered partial tail (empty when fully drained). */
  pending(): string
}

/**
 * Stateful decoder for live input: it carries a partial trailing escape/paste
 * across chunks, so a sequence (or a large paste) split over multiple stdin reads
 * still parses correctly. One decoder per input stream.
 */
export function createKeyDecoder(): KeyDecoder {
  let pending = ''
  const mouse = newMouseState()
  return {
    feed(data) {
      const s = pending + (typeof data === 'string' ? data : decoder.decode(data))
      const events: InputEvent[] = []
      let i = 0
      while (i < s.length) {
        const consumed = stepOne(s, i, events, mouse)
        if (consumed === -1) break // truncated tail: buffer it for the next feed
        i += consumed
      }
      pending = s.slice(i)
      // A stuck non-paste partial sequence is flushed so it can't grow unbounded.
      if (pending.length > MAX_PENDING && !pending.startsWith(PASTE_START)) {
        for (const ev of parseKeys(pending)) events.push(ev)
        pending = ''
      }
      return events
    },
    flush() {
      // Don't force-flush an in-progress bracketed paste — it legitimately spans
      // reads and must wait for its end marker (or the MAX_PENDING backstop).
      if (pending === '' || pending.startsWith(PASTE_START)) return []
      const events = parseKeys(pending)
      pending = ''
      return events
    },
    pending() {
      return pending
    },
  }
}

/**
 * Parse an escape sequence starting at `i`. Returns bytes consumed, `0` for a
 * bare/unrecognised ESC (caller emits Escape), or `-1` for a truncated sequence
 * that needs more input.
 */
function parseEscape(s: string, i: number, out: InputEvent[], mouse: MouseState): number {
  const next = s[i + 1]
  if (next === undefined) return -1 // live decoder buffers; stateless parser flushes as Escape
  if (next === '[') return parseCSI(s, i, out, mouse)
  if (next === 'O') return parseSS3(s, i, out)
  // ESC + key → Alt-modified.
  const code = s.charCodeAt(i + 1)
  if (code === 0x7f || code === 0x08) {
    out.push(key('backspace', { alt: true, raw: s.slice(i, i + 2) }))
    return 2
  }
  if (code >= 0x20) {
    const ch = String.fromCodePoint(s.codePointAt(i + 1)!)
    out.push(key(ch, { alt: true, raw: '\x1b' + ch }))
    return 1 + ch.length
  }
  return 0
}

function parseCSI(s: string, i: number, out: InputEvent[], mouse: MouseState): number {
  if (s[i + 2] === '<') return parseSgrMouse(s, i, out, mouse)
  if (s[i + 2] === 'M') return parseX10Mouse(s, i, out, mouse)
  // Private CSI (`CSI ? …`). Consume it whole so its bytes never leak as stray
  // keys, and surface the DEC mode 2031 color-scheme report `CSI ? 997 ; <1|2> n`
  // (1 = dark, 2 = light) as a ThemeEvent.
  if (s[i + 2] === '?') {
    let k = i + 3
    let p = ''
    while (k < s.length && (s[k] === ';' || (s[k]! >= '0' && s[k]! <= '9'))) {
      p += s[k]
      k += 1
    }
    const f = s[k]
    if (f === undefined) return -1 // truncated private CSI: need more input
    if (f === 'n') {
      const [code, value] = p.split(';')
      if (code === '997') out.push({ type: 'theme', mode: value === '2' ? 'light' : 'dark', raw: s.slice(i, k + 1) })
    }
    return k + 1 - i // consume any private CSI; emit nothing for non-997 forms
  }
  let j = i + 2
  let params = ''
  // `:` is accepted so the Kitty CSI-u sub-parameter form (`code;mods:event`) is
  // captured whole; legacy sequences below never carry a `:` so this is inert there.
  while (j < s.length && (s[j]! === ';' || s[j]! === ':' || (s[j]! >= '0' && s[j]! <= '9'))) {
    params += s[j]
    j += 1
  }
  const final = s[j]
  if (final === undefined) return -1 // truncated CSI: need more input

  // Bracketed paste: capture everything up to the end marker as literal text.
  if (params === '200' && final === '~') {
    const start = j + 1
    const end = s.indexOf(PASTE_END, start)
    if (end === -1) return -1 // paste not yet terminated: buffer until it is
    out.push({ type: 'paste', text: s.slice(start, end) })
    return end + PASTE_END.length - i
  }

  const raw = s.slice(i, j + 1)
  const consumed = j + 1 - i
  if (final === 'u') return parseCsiU(params, raw, consumed, out)
  if (final === 'Z') {
    out.push(key('tab', { shift: true, raw }))
    return consumed
  }
  const parts = params.split(';')
  const mods = { ...decodeMod(parts[1]), raw }
  if (ARROW_NAMES[final]) {
    out.push(key(ARROW_NAMES[final]!, mods))
    return consumed
  }
  if (final === '~' && TILDE_NAMES[parts[0]!]) {
    out.push(key(TILDE_NAMES[parts[0]!]!, mods))
    return consumed
  }
  return consumed // recognised-but-unmapped CSI: consume, emit nothing
}

function decodeMouseModifiers(code: number): Mods {
  return {
    shift: !!(code & 4),
    alt: !!(code & 8),
    ctrl: !!(code & 16),
    meta: false,
  }
}

function mouseButton(code: number): MouseButton | null {
  if (code & 64) return code & 1 ? 'wheelDown' : 'wheelUp'
  return MOUSE_BUTTONS[code & 3] ?? null
}

function pushMouse(
  out: InputEvent[],
  mouse: MouseState,
  code: number,
  x: number,
  y: number,
  final: 'M' | 'm',
  raw: string,
): void {
  const wheel = !!(code & 64)
  const motion = !!(code & 32)
  const button = mouseButton(code)
  const mods = decodeMouseModifiers(code)
  let kind: MouseEvent['kind']

  if (wheel) {
    kind = 'wheel'
  } else if (final === 'm') {
    kind = 'up'
  } else if (motion) {
    kind = mouse.buttons.size > 0 ? 'drag' : 'move'
  } else {
    kind = 'down'
  }

  if (kind === 'down' && button) mouse.buttons.add(button)
  if (kind === 'up') {
    if (button) mouse.buttons.delete(button)
    else mouse.buttons.clear()
  }

  out.push({
    type: 'mouse',
    kind,
    button,
    x,
    y,
    ctrl: !!mods.ctrl,
    alt: !!mods.alt,
    shift: !!mods.shift,
    meta: false,
    raw,
  })
}

function parseSgrMouse(s: string, i: number, out: InputEvent[], mouse: MouseState): number {
  let j = i + 3
  while (j < s.length && (s[j]! === ';' || (s[j]! >= '0' && s[j]! <= '9'))) j += 1
  const final = s[j]
  if (final === undefined) return -1
  if (final !== 'M' && final !== 'm') return j + 1 - i
  const raw = s.slice(i, j + 1)
  const parts = s.slice(i + 3, j).split(';')
  if (parts.length !== 3) return j + 1 - i
  const code = Number.parseInt(parts[0]!, 10)
  const x = Number.parseInt(parts[1]!, 10) - 1
  const y = Number.parseInt(parts[2]!, 10) - 1
  if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    return j + 1 - i
  }
  pushMouse(out, mouse, code, x, y, final, raw)
  return j + 1 - i
}

function parseX10Mouse(s: string, i: number, out: InputEvent[], mouse: MouseState): number {
  if (i + 5 >= s.length) return -1
  const raw = s.slice(i, i + 6)
  const code = s.charCodeAt(i + 3) - 32
  const x = s.charCodeAt(i + 4) - 33
  const y = s.charCodeAt(i + 5) - 33
  if (x < 0 || y < 0) return 6
  pushMouse(out, mouse, code, x, y, code === 3 ? 'm' : 'M', raw)
  return 6
}

function parseSS3(s: string, i: number, out: InputEvent[]): number {
  const final = s[i + 2]
  if (final === undefined) return -1 // truncated SS3: need more input
  const name = SS3_NAMES[final]
  if (!name) return 0
  out.push(key(name, { raw: s.slice(i, i + 3) }))
  return 3
}

/**
 * Test whether an event matches a key spec like `"ctrl+c"`, `"shift+tab"`,
 * `"enter"`. Modifiers are order-insensitive; `super` is an alias for `meta`.
 */
export function matchesKey(ev: InputEvent, spec: string): boolean {
  if (ev.type !== 'key') return false
  const parts = spec.toLowerCase().split('+')
  const base = parts.pop()!
  return (
    ev.name.toLowerCase() === base &&
    ev.ctrl === parts.includes('ctrl') &&
    ev.alt === parts.includes('alt') &&
    ev.shift === parts.includes('shift') &&
    ev.meta === (parts.includes('meta') || parts.includes('super'))
  )
}

/** Tiny helper for building key specs: `Key.ctrl("c")`, `Key.enter`. */
export const Key = {
  ctrl: (k: string) => `ctrl+${k}`,
  alt: (k: string) => `alt+${k}`,
  shift: (k: string) => `shift+${k}`,
  enter: 'enter',
  tab: 'tab',
  escape: 'escape',
  backspace: 'backspace',
  delete: 'delete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  space: 'space',
} as const
