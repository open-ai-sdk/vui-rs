import { loadNativeLib, loadNativeLibAsync } from './native/load-native-lib.ts'

export {
  Attr,
  CELL_BYTES,
  EditMotion,
  type EditMotionCode,
  EXPECTED_ABI_VERSION,
  LINK_SHIFT,
  NativeTextWrap,
  type NativeTextWrapCode,
  NodeKindCode,
  Status,
  STYLE_FFI_BYTES,
  symbols,
  loadNativeLibAsync,
} from './native/load-native-lib.ts'
export type { NativeLib } from './native/load-native-lib.ts'
export { parseColor } from './color.ts'
export { NAMED_COLORS, parseHex } from './named-colors.ts'
export { Renderer, rgba, type TextStyle, type ClipRect } from './renderer.ts'
export { OffscreenBuffer } from './offscreen-buffer.ts'
export {
  TextBuffer,
  TextBufferView,
  EditBuffer,
  EditorView,
  wrapCode,
  type TextMeasure,
  type TextWrapMode,
} from './text/index.ts'
export { charWidth, strWidth } from './char-width.ts'
export { decodeImage, decodeImageBytes, type DecodedImage } from './image-decode.ts'
export {
  parseKeys,
  createKeyDecoder,
  matchesKey,
  Key,
  type KeyDecoder,
  type KeyEvent,
  type MouseButton,
  type MouseEvent,
  type PasteEvent,
  type ThemeEvent,
  type InputEvent,
} from './keys.ts'
export { queryBackgroundColor, queryColorScheme, type QueryColorSchemeOptions } from './query-color-scheme.ts'
export { createTerminalSession, type TerminalSession, type TerminalSessionOptions } from './terminal-session.ts'
export { hostTreeHash, VuiNode, type LayoutRect, type RectEdges, type TextRun, type TextWrapName } from './node.ts'
export { packStyle, type AlignValue, type Dim, type JustifyValue, type Sides, type VuiStyle } from './style.ts'

/**
 * Memoized handle to the loaded vui-core native library. The first call
 * resolves, opens, and ABI-checks the library; subsequent calls reuse the
 * memoized handle.
 *
 * In dev and npm-installed environments all candidates are real filesystem
 * paths — this synchronous form works fine.
 *
 * Inside a `bun build --compile` binary the dylib is embedded in the virtual
 * $bunfs filesystem and requires an async import to surface it. Call
 * `loadNativeLibAsync()` once at application startup before constructing any
 * FFI-using class (Renderer, OffscreenBuffer, TextBuffer, etc.); subsequent
 * calls to getNativeLib() / loadNativeLib() will hit the memoized fast path.
 */
export function getNativeLib() {
  return loadNativeLib()
}

/**
 * Async variant of getNativeLib(). Required for the first call inside a
 * `bun build --compile` binary where the native dylib is embedded in $bunfs
 * and must be extracted before dlopen(2) can open it.
 *
 * Safe to call in all environments; in dev/npm it resolves synchronously via
 * the cached value or the filesystem candidates.
 */
export async function getNativeLibAsync() {
  return loadNativeLibAsync()
}
