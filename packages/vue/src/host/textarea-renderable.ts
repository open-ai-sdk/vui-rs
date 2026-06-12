// Native-backed multi-line editor host node. The editing state lives in
// `@vui-rs/core`'s native EditBuffer/EditorView; this class only adapts it to the
// JS-host Renderable paint/lifecycle contract.
import { EditBuffer, EditorView, EditMotion, type EditMotionCode, type TextWrapMode } from '@vui-rs/core'
import { drawChrome } from './paint-ops.ts'
import { type HostContext, type PaintBuffer, type PaintCtx, Renderable } from './renderable.ts'

export interface TextareaState {
  placeholder: string
  focused: boolean
  cursorColor?: number
  placeholderColor?: number
  wrap: TextWrapMode
  autoWidth: boolean
  autoHeight: boolean
  tabBehavior: 'focus' | 'indent' | 'capture'
  tabSize: number
  maxLength?: number
  ctrlCBehavior?: 'exit' | 'capture'
}

export class TextareaRenderable extends Renderable {
  edit = new EditBuffer()
  editor = new EditorView(this.edit, 1, 1, 'word')
  textarea: TextareaState = {
    placeholder: '',
    focused: false,
    wrap: 'word',
    autoWidth: true,
    autoHeight: true,
    tabBehavior: 'focus',
    tabSize: 2,
  }

  constructor(ctx: HostContext, tag: string) {
    super(ctx, 'textarea', tag)
    this.focusable = true
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint, {
      fg: this.ctx.theme.fg,
      border: this.ctx.theme.border,
    })
    const width = Math.max(1, ctx.cx1 - ctx.cx0)
    const height = Math.max(1, ctx.cy1 - ctx.cy0)
    this.editor.setViewport(width, height)
    this.editor.setWrap(this.textarea.wrap)
    this.editor.setFocused(this.textarea.focused)
    const fg = this.paint.fg ?? this.ctx.theme.fg
    const bg = this.paint.bg ?? buffer.bgUnder(ctx.cx0, ctx.cy0)
    const cursorBg = this.textarea.cursorColor ?? fg
    buffer.drawEditor(this.editor, ctx.cx0, ctx.cy0, fg, bg, cursorBg, this.paint.attrs, ctx.contentClip)
    if (!this.getValue() && this.textarea.placeholder && !this.textarea.focused) {
      buffer.drawText(
        ctx.cx0,
        ctx.cy0,
        this.textarea.placeholder,
        this.textarea.placeholderColor ?? fg,
        bg,
        this.paint.attrs,
        ctx.contentClip,
      )
    }
  }

  getValue(): string {
    return this.edit.getValue()
  }

  setValue(value: string): void {
    this.edit.setValue(value)
    this.#touch()
  }

  insert(text: string): boolean {
    const insert = clampInsert(
      this.getValue(),
      this.hasSelection() ? this.selectedText() : '',
      text,
      this.textarea.maxLength,
    )
    if (!insert) return false
    this.edit.insert(insert)
    this.#touch()
    return true
  }

  newline(): boolean {
    if (!canInsert(this.getValue(), this.hasSelection() ? this.selectedText() : '', this.textarea.maxLength))
      return false
    this.edit.newline()
    this.#touch()
    return true
  }

  backspace(): void {
    this.edit.backspace()
    this.#touch()
  }

  delete(): void {
    this.edit.delete()
    this.#touch()
  }

  move(motion: EditMotionCode, selecting = false): void {
    this.#syncEditorViewportFromRect()
    this.editor.move(motion, selecting)
    this.#touch()
  }

  syncAutoSizeStyle(): boolean {
    if (!this.textarea.autoWidth && !this.textarea.autoHeight) return false
    let changed = false
    const intrinsic = this.editor.measure(1_000_000, this.textarea.wrap)
    const width = this.textarea.autoWidth
      ? Math.max(1, intrinsic.maxWidth)
      : Math.max(1, typeof this.style.width === 'number' ? Math.floor(this.style.width) : intrinsic.maxWidth)
    const measured = this.editor.measure(width, this.textarea.wrap)
    if (this.textarea.autoWidth && this.style.width !== width) {
      this.style.width = width
      changed = true
    }
    if (this.textarea.autoHeight) {
      const height = clampHeight(measured.lineCount, this.style.minHeight, this.style.maxHeight)
      if (this.style.height !== height) {
        this.style.height = height
        changed = true
      }
    }
    if (changed) this.ctx.dirtyLayout.add(this)
    return changed
  }

  selectAll(): void {
    this.edit.selectAll()
    this.#touch()
  }

  hasSelection(): boolean {
    return this.edit.hasSelection()
  }

  selectedText(): string {
    return this.edit.selectedText()
  }

  deleteSelection(): boolean {
    const changed = this.edit.deleteSelection()
    if (changed) this.#touch()
    return changed
  }

  deleteToLineStart(): boolean {
    this.move(EditMotion.Home, true)
    return this.deleteSelection()
  }

  deleteWordLeft(): boolean {
    this.move(EditMotion.WordLeft, true)
    return this.deleteSelection()
  }

  deleteToLineEnd(): boolean {
    this.move(EditMotion.End, true)
    return this.deleteSelection()
  }

  undo(): void {
    if (this.edit.undo()) this.#touch()
  }

  redo(): void {
    if (this.edit.redo()) this.#touch()
  }

  dispose(): void {
    this.editor.free()
    this.edit.free()
  }

  #touch(): void {
    if (this.textarea.autoWidth || this.textarea.autoHeight) this.ctx.dirtyLayout.add(this)
    this.markDirty()
    this.ctx.scheduleRender()
  }

  #syncEditorViewportFromRect(): void {
    const rect = this.rect
    if (!rect) return
    const width = Math.max(
      1,
      Math.round(rect.w - rect.padding.left - rect.padding.right - rect.border.left - rect.border.right),
    )
    const height = Math.max(
      1,
      Math.round(rect.h - rect.padding.top - rect.padding.bottom - rect.border.top - rect.border.bottom),
    )
    this.editor.setViewport(width, height)
    this.editor.setWrap(this.textarea.wrap)
  }
}

export { EditMotion }

function clampHeight(value: number, min: unknown, max: unknown): number {
  let out = Math.max(1, value)
  if (typeof min === 'number') out = Math.max(out, min)
  if (typeof max === 'number') out = Math.min(out, Math.max(1, max))
  return out
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemeCount(value: string): number {
  let count = 0
  for (const _ of segmenter.segment(value)) count += 1
  return count
}

function graphemes(value: string): string[] {
  const out: string[] = []
  for (const seg of segmenter.segment(value)) out.push(seg.segment)
  return out
}

function canInsert(value: string, selection: string, maxLength: number | undefined): boolean {
  return maxLength === undefined || graphemeCount(value) - graphemeCount(selection) < maxLength
}

function clampInsert(value: string, selection: string, insert: string, maxLength: number | undefined): string {
  if (maxLength === undefined) return insert
  const room = maxLength - (graphemeCount(value) - graphemeCount(selection))
  if (room <= 0) return ''
  const gs = graphemes(insert)
  return gs.length > room ? gs.slice(0, room).join('') : insert
}
