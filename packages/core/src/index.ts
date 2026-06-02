import { loadNativeLib } from "./native/load-native-lib.ts";

export {
  Attr,
  BorderStyleCode,
  CELL_BYTES,
  EXPECTED_ABI_VERSION,
  NodeKindCode,
  Status,
  STYLE_FFI_BYTES,
  symbols,
  TitleAlignCode,
} from "./native/load-native-lib.ts";
export type { NativeLib } from "./native/load-native-lib.ts";
export { Renderer, rgba, type TextStyle } from "./renderer.ts";
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
