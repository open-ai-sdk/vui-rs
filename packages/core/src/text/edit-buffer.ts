import type { Pointer } from 'bun:ffi'
import { EditMotion, Status, type EditMotionCode } from '../native/ffi-symbols.ts'
import { loadNativeLib } from '../native/load-native-lib.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function check(status: number, op: string): void {
  if (status !== Status.OK) throw new Error(`vui-core ${op} failed with status ${status}`)
}

export { EditMotion, type EditMotionCode }

export class EditBuffer {
  #lib = loadNativeLib()
  #ptr: Pointer
  #cursor = new Uint32Array(2)
  #changed = new Uint32Array(1)

  constructor(value = '') {
    const ptr = this.#lib.symbols.vui_editbuf_new()
    if (ptr === null) throw new Error('vui-core: failed to allocate EditBuffer')
    this.#ptr = ptr
    if (value) this.setValue(value)
  }

  get nativePtr(): Pointer {
    return this.#ptr
  }

  getValue(): string {
    const len = Number(this.#lib.symbols.vui_editbuf_value_len(this.#ptr))
    if (len === 0) return ''
    const out = new Uint8Array(len)
    const copied = Number(this.#lib.symbols.vui_editbuf_copy_value(this.#ptr, out, out.byteLength))
    return decoder.decode(out.subarray(0, copied))
  }

  setValue(value: string): void {
    const bytes = encoder.encode(value)
    check(this.#lib.symbols.vui_editbuf_set_value(this.#ptr, bytes, bytes.byteLength), 'editbuf_set_value')
  }

  insert(text: string): void {
    const bytes = encoder.encode(text)
    check(this.#lib.symbols.vui_editbuf_insert(this.#ptr, bytes, bytes.byteLength), 'editbuf_insert')
  }

  newline(): void {
    check(this.#lib.symbols.vui_editbuf_newline(this.#ptr), 'editbuf_newline')
  }

  backspace(): void {
    check(this.#lib.symbols.vui_editbuf_backspace(this.#ptr), 'editbuf_backspace')
  }

  delete(): void {
    check(this.#lib.symbols.vui_editbuf_delete(this.#ptr), 'editbuf_delete')
  }

  move(motion: EditMotionCode, selecting = false): void {
    check(this.#lib.symbols.vui_editbuf_move(this.#ptr, motion, selecting ? 1 : 0), 'editbuf_move')
  }

  selectAll(): void {
    check(this.#lib.symbols.vui_editbuf_select_all(this.#ptr), 'editbuf_select_all')
  }

  hasSelection(): boolean {
    return this.#lib.symbols.vui_editbuf_has_selection(this.#ptr) !== 0
  }

  selectedText(): string {
    const len = Number(this.#lib.symbols.vui_editbuf_selected_len(this.#ptr))
    if (len === 0) return ''
    const out = new Uint8Array(len)
    const copied = Number(this.#lib.symbols.vui_editbuf_copy_selected(this.#ptr, out, out.byteLength))
    return decoder.decode(out.subarray(0, copied))
  }

  deleteSelection(): boolean {
    check(this.#lib.symbols.vui_editbuf_delete_selection(this.#ptr, this.#changed), 'editbuf_delete_selection')
    return this.#changed[0] === 1
  }

  undo(): boolean {
    check(this.#lib.symbols.vui_editbuf_undo(this.#ptr, this.#changed), 'editbuf_undo')
    return this.#changed[0] === 1
  }

  redo(): boolean {
    check(this.#lib.symbols.vui_editbuf_redo(this.#ptr, this.#changed), 'editbuf_redo')
    return this.#changed[0] === 1
  }

  canUndo(): boolean {
    return this.#lib.symbols.vui_editbuf_can_undo(this.#ptr) !== 0
  }

  canRedo(): boolean {
    return this.#lib.symbols.vui_editbuf_can_redo(this.#ptr) !== 0
  }

  cursor(): { row: number; col: number } {
    check(this.#lib.symbols.vui_editbuf_cursor(this.#ptr, this.#cursor, this.#cursor.subarray(1)), 'editbuf_cursor')
    return { row: this.#cursor[0]!, col: this.#cursor[1]! }
  }

  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_editbuf_free(this.#ptr)
      this.#ptr = null as unknown as Pointer
    }
  }
}
