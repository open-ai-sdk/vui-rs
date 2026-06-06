import { describe, expect, test } from 'bun:test'
import { Attr, EditBuffer, EditMotion, EditorView, Renderer, TextBuffer, TextBufferView, rgba } from '../src/index.ts'
import { allGlyphs, cellAttrs, cellFg, channels } from '../../vue/test/helpers/read-buffer.ts'

describe('native text subsystem wrappers', () => {
  test('TextBufferView measures and draws word-wrapped content', () => {
    const r = new Renderer(12, 4)
    const buf = new TextBuffer('hello world')
    const view = new TextBufferView(buf, 5, 'word')
    expect(view.measure(5, 'word')).toEqual({ lineCount: 2, maxWidth: 5 })
    r.clear()
    r.drawTextBuffer(view, 0, 0, { fg: rgba(255, 255, 255), bg: rgba(0, 0, 0) }, { x0: 0, y0: 0, x1: 12, y1: 4 })
    expect(allGlyphs(r)).toBe('helloworld')
    view.free()
    buf.free()
    r.free()
  })

  test('TextBufferView preserves styled runs when drawing', () => {
    const r = new Renderer(8, 2)
    const buf = new TextBuffer()
    const red = rgba(255, 0, 0)
    const green = rgba(0, 255, 0)
    buf.setRuns([
      { text: 'ab', fg: red },
      { text: 'cd', fg: green, attrs: Attr.BOLD },
    ])
    const view = new TextBufferView(buf, 3, 'char')
    r.clear()
    r.drawTextBuffer(view, 0, 0, { fg: rgba(255, 255, 255), bg: rgba(0, 0, 0) }, { x0: 0, y0: 0, x1: 8, y1: 2 })
    expect(allGlyphs(r)).toBe('abcd')
    expect(cellFg(r, 0, 0)).toEqual(channels(red))
    expect(cellFg(r, 2, 0)).toEqual(channels(green))
    expect(cellAttrs(r, 2, 0) & Attr.BOLD).toBe(Attr.BOLD)
    view.free()
    buf.free()
    r.free()
  })

  test('EditBuffer supports multiline editing, cursor motion, and burst undo', () => {
    const edit = new EditBuffer()
    edit.insert('hello')
    edit.newline()
    edit.insert('world')
    expect(edit.getValue()).toBe('hello\nworld')
    edit.move(EditMotion.Home)
    edit.insert('wide ')
    expect(edit.getValue()).toBe('hello\nwide world')
    expect(edit.cursor()).toEqual({ row: 1, col: 5 })
    edit.undo()
    expect(edit.getValue()).toBe('hello\nworld')
    edit.setValue('reset')
    expect(edit.canUndo()).toBe(false)
    expect(edit.undo()).toBe(false)
    expect(edit.getValue()).toBe('reset')
    edit.free()
  })

  test('EditBuffer exposes selected text and deletes selection', () => {
    const edit = new EditBuffer('hello')
    edit.move(EditMotion.DocStart)
    edit.move(EditMotion.Right, true)
    edit.move(EditMotion.Right, true)
    expect(edit.hasSelection()).toBe(true)
    expect(edit.selectedText()).toBe('he')
    expect(edit.deleteSelection()).toBe(true)
    expect(edit.getValue()).toBe('llo')
    expect(edit.hasSelection()).toBe(false)
    edit.free()
  })

  test('EditorView draws visible lines through the renderer', () => {
    const r = new Renderer(10, 3)
    const edit = new EditBuffer('one two three')
    const view = new EditorView(edit, 4, 3, 'word')
    r.clear()
    r.drawEditor(view, 0, 0, { fg: rgba(255, 255, 255), bg: rgba(0, 0, 0) }, { x0: 0, y0: 0, x1: 10, y1: 3 })
    expect(allGlyphs(r)).toBe('onetwothre')
    view.free()
    edit.free()
    r.free()
  })

  test('EditorView moves up and down by wrapped visual rows', () => {
    const edit = new EditBuffer('abcdef')
    const view = new EditorView(edit, 3, 2, 'char')
    edit.move(EditMotion.DocStart)
    view.move(EditMotion.Down)
    expect(edit.cursor()).toEqual({ row: 0, col: 3 })
    view.move(EditMotion.Up)
    expect(edit.cursor()).toEqual({ row: 0, col: 0 })
    view.free()
    edit.free()
  })
})
