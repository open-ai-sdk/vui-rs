import { loadNativeLib } from "./native/load-native-lib.ts";

export {
  Attr,
  BorderStyleCode,
  CELL_BYTES,
  EditMotion,
  type EditMotionCode,
  EXPECTED_ABI_VERSION,
  NodeKindCode,
  Status,
  STYLE_FFI_BYTES,
  symbols,
  TitleAlignCode,
} from "./native/load-native-lib.ts";
export type { NativeLib } from "./native/load-native-lib.ts";
export { EditApi } from "./edit.ts";
export { parseColor } from "./color.ts";
export { NAMED_COLORS, parseHex } from "./named-colors.ts";
export { Renderer, rgba, type TextStyle } from "./renderer.ts";
export {
  parseKeys,
  createKeyDecoder,
  matchesKey,
  Key,
  type KeyDecoder,
  type KeyEvent,
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
  type BorderName,
  type TextRun,
  type TitleAlignName,
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
