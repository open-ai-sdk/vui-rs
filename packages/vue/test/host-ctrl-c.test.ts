// The Ctrl+C fallthrough priority in `handleInputEvent`: selection-copy and a
// focused textarea-with-selection are handled earlier and return; what remains is
// the capture-input vs `onCtrlC`-override vs default-exit decision. The session's
// `handleInputEvent` closure isn't reachable offscreen (no terminal pump without a
// real session), so that decision lives in the pure `resolveCtrlCAction` helper and
// is asserted directly here.
import { describe, expect, test } from 'bun:test'
import { resolveCtrlCAction } from '../src/host/create-host-app.ts'

describe('resolveCtrlCAction', () => {
  test('onCtrlC set + not consumed by a capture input → delegate (no exit)', () => {
    expect(resolveCtrlCAction(false, true)).toBe('delegate')
  })

  test('no onCtrlC + not consumed → exit (default host behavior unchanged)', () => {
    expect(resolveCtrlCAction(false, false)).toBe('exit')
  })

  test('capture input preventDefault wins over onCtrlC → consume (neither delegate nor exit)', () => {
    expect(resolveCtrlCAction(true, true)).toBe('consume')
  })

  test('capture input preventDefault with no onCtrlC → consume (clears input, no exit)', () => {
    expect(resolveCtrlCAction(true, false)).toBe('consume')
  })
})
