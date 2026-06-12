// An `<input>` host node — a single-line editable field. Under the JS host the
// edit model (graphemes + cursor + motion) lives HERE in JS (the FFI host kept it
// in the native EditBuffer). `renderSelf` paints the value/placeholder + block
// cursor with horizontal scroll (paint.rs `draw_edit`); the host `<VuiHostInput>`
// component drives these ops from keyboard events delivered by the focus manager.
import { EditMotion } from '@vui-rs/core'
import { drawChrome, drawEdit } from './paint-ops.ts'
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from './renderable.ts'

/** Editable state surfaced to paint (cursor is a grapheme index; column is derived). */
export interface EditState {
  value: string
  placeholder: string
  cursor: number
  focused: boolean
  /**
   * Blink phase for the block cursor: `true` (or unset) paints the cursor, `false`
   * is the dark half of the blink. Toggled on a timer by `EditRenderable` while
   * focused; the painter (`drawEdit`) skips the cursor cell when this is `false`.
   */
  cursorVisible?: boolean
  maxLength?: number
  cursorColor?: number
  placeholderColor?: number
  /**
   * Tab handling: `'focus'` (default) lets the host consume Tab for focus
   * traversal; `'capture'` dispatches Tab to this input instead, so a keyDown
   * handler on its wrapper can drive an autocomplete completion.
   */
  tabBehavior?: 'focus' | 'capture'
  /**
   * Ctrl+C handling: `'exit'` (default) lets the host quit the app; `'capture'`
   * dispatches Ctrl+C to this input first (so a handler can e.g. clear the text)
   * and only quits if the event is left unhandled (not `preventDefault`-ed).
   */
  ctrlCBehavior?: 'exit' | 'capture'
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (s: string): string[] => {
  const out: string[] = []
  for (const seg of segmenter.segment(s)) out.push(seg.segment)
  return out
}
const isSpace = (g: string): boolean => g.trim() === ''

/** Classic xterm cursor blink half-period (ms): solid for this long, then dark for this long. */
export const DEFAULT_BLINK_MS = 530

export class EditRenderable extends Renderable {
  edit: EditState = {
    value: '',
    placeholder: '',
    cursor: 0,
    focused: false,
    cursorVisible: true,
  }

  /** Blink half-period in ms; `0` disables blink (steady cursor). Driven by the `cursorBlink` prop. */
  blinkIntervalMs = DEFAULT_BLINK_MS
  #blinkTimer: ReturnType<typeof setInterval> | null = null

  constructor(ctx: HostContext, tag: string) {
    super(ctx, 'edit', tag)
  }

  /**
   * Focus gate for the cursor blink. Routed through here (not a bare
   * `edit.focused =`) by both the focus manager and `patch-prop` so the blink
   * timer starts on focus and stops on blur. Caller still fires focus/blur events.
   */
  setFocused(on: boolean): void {
    this.edit.focused = on
    if (on) this.#startBlink()
    else this.#stopBlink()
    this.markDirty()
  }

  /** Set the blink half-period; `<= 0` (or non-finite) means a steady, non-blinking cursor. */
  setBlinkInterval(ms: number): void {
    this.blinkIntervalMs = Number.isFinite(ms) && ms > 0 ? ms : 0
    if (this.edit.focused) this.#startBlink()
  }

  /** (Re)start the blink: cursor solid now, then toggle every `blinkIntervalMs`. No-op if disabled. */
  #startBlink(): void {
    this.#stopBlink()
    this.edit.cursorVisible = true
    if (this.blinkIntervalMs <= 0) return
    this.#blinkTimer = setInterval(() => {
      this.edit.cursorVisible = !this.edit.cursorVisible
      this.markDirty()
      this.ctx.scheduleRender()
    }, this.blinkIntervalMs)
  }

  /** Stop the blink and leave the cursor solid (its resting state). */
  #stopBlink(): void {
    if (this.#blinkTimer) {
      clearInterval(this.#blinkTimer)
      this.#blinkTimer = null
    }
    this.edit.cursorVisible = true
  }

  /** Unmount: drop the blink timer so a removed input leaves no live interval. */
  dispose(): void {
    this.#stopBlink()
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    const themeFg = this.ctx.theme.fg
    drawChrome(buffer, ctx, this.paint, { fg: themeFg, border: this.ctx.theme.border })
    drawEdit(buffer, ctx.contentClip, ctx.cx0, ctx.cy0, ctx.cx1, this.edit, this.paint, themeFg)
  }

  // --- JS edit model: grapheme-indexed cursor, motions, and editing. ---

  getValue(): string {
    return this.edit.value
  }

  /** External value write (v-model): replace, cursor to end. No change emit. */
  setValue(text: string): void {
    this.edit.value = text
    this.edit.cursor = graphemes(text).length
    this.#touch()
  }

  insert(text: string): void {
    const gs = graphemes(this.edit.value)
    let ins = graphemes(text)
    if (this.edit.maxLength !== undefined) {
      const room = this.edit.maxLength - gs.length
      if (room <= 0) return
      if (ins.length > room) ins = ins.slice(0, room)
    }
    gs.splice(this.edit.cursor, 0, ...ins)
    this.edit.value = gs.join('')
    this.edit.cursor += ins.length
    this.#touch()
  }

  backspace(): void {
    if (this.edit.cursor <= 0) return
    const gs = graphemes(this.edit.value)
    gs.splice(this.edit.cursor - 1, 1)
    this.edit.value = gs.join('')
    this.edit.cursor -= 1
    this.#touch()
  }

  delete(): void {
    const gs = graphemes(this.edit.value)
    if (this.edit.cursor >= gs.length) return
    gs.splice(this.edit.cursor, 1)
    this.edit.value = gs.join('')
    this.#touch()
  }

  /** Delete everything before the cursor (readline `Ctrl+U`); cursor moves to start. */
  deleteToStart(): void {
    if (this.edit.cursor <= 0) return
    const gs = graphemes(this.edit.value)
    gs.splice(0, this.edit.cursor)
    this.edit.value = gs.join('')
    this.edit.cursor = 0
    this.#touch()
  }

  /** Delete the word before the cursor (readline `Ctrl+W`): trailing spaces, then non-spaces. */
  deleteWordLeft(): void {
    if (this.edit.cursor <= 0) return
    const gs = graphemes(this.edit.value)
    let c = this.edit.cursor
    while (c > 0 && isSpace(gs[c - 1]!)) c--
    while (c > 0 && !isSpace(gs[c - 1]!)) c--
    gs.splice(c, this.edit.cursor - c)
    this.edit.value = gs.join('')
    this.edit.cursor = c
    this.#touch()
  }

  /** Delete everything from the cursor to the end of the line (readline `Ctrl+K`). */
  deleteToEnd(): void {
    const gs = graphemes(this.edit.value)
    if (this.edit.cursor >= gs.length) return
    gs.splice(this.edit.cursor)
    this.edit.value = gs.join('')
    this.#touch()
  }

  move(motion: number): void {
    const gs = graphemes(this.edit.value)
    const len = gs.length
    let c = this.edit.cursor
    switch (motion) {
      case EditMotion.Left:
        c = Math.max(0, c - 1)
        break
      case EditMotion.Right:
        c = Math.min(len, c + 1)
        break
      case EditMotion.Home:
        c = 0
        break
      case EditMotion.End:
        c = len
        break
      case EditMotion.WordLeft:
        while (c > 0 && isSpace(gs[c - 1]!)) c--
        while (c > 0 && !isSpace(gs[c - 1]!)) c--
        break
      case EditMotion.WordRight:
        while (c < len && isSpace(gs[c]!)) c++
        while (c < len && !isSpace(gs[c]!)) c++
        break
    }
    this.edit.cursor = c
    this.#touch()
  }

  #touch(): void {
    // Typing/motion makes the cursor solid immediately, then resumes blinking —
    // so the caret is always visible at the moment of activity (restarts the timer).
    if (this.edit.focused) this.#startBlink()
    this.markDirty()
    this.ctx.scheduleRender()
  }
}
