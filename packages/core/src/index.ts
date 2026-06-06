import { loadNativeLib } from "./native/load-native-lib.ts";

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
} from "./native/load-native-lib.ts";
export type { NativeLib } from "./native/load-native-lib.ts";
export { parseColor } from "./color.ts";
export { NAMED_COLORS, parseHex } from "./named-colors.ts";
export { Renderer, rgba, type TextStyle, type ClipRect } from "./renderer.ts";
export { OffscreenBuffer } from "./offscreen-buffer.ts";
export {
  TextBuffer,
  TextBufferView,
  EditBuffer,
  EditorView,
  wrapCode,
  type TextMeasure,
  type TextWrapMode,
} from "./text/index.ts";
export { charWidth, strWidth } from "./char-width.ts";
export { decodeImage, decodeImageBytes, type DecodedImage } from "./image-decode.ts";
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
  type InputEvent,
} from "./keys.ts";
export {
  createTerminalSession,
  type TerminalSession,
  type TerminalSessionOptions,
} from "./terminal-session.ts";
export {
  hostTreeHash,
  VuiNode,
  type LayoutRect,
  type RectEdges,
  type TextRun,
  type TextWrapName,
} from "./node.ts";
export {
  packStyle,
  type AlignValue,
  type Dim,
  type JustifyValue,
  type Sides,
  type VuiStyle,
} from "./style.ts";

/**
 * Memoized handle to the loaded vui-core native library. The first call
 * resolves, opens, and ABI-checks the library; subsequent calls reuse it.
 */
export function getNativeLib() {
  return loadNativeLib();
}
