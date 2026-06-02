import { loadNativeLib } from "./native/load-native-lib.ts";

export {
  Attr,
  CELL_BYTES,
  EXPECTED_ABI_VERSION,
  Status,
  symbols,
} from "./native/load-native-lib.ts";
export type { NativeLib } from "./native/load-native-lib.ts";
export { Renderer, rgba, type TextStyle } from "./renderer.ts";

/**
 * Memoized handle to the loaded vui-core native library. The first call
 * resolves, opens, and ABI-checks the library; subsequent calls reuse it.
 */
export function getNativeLib() {
  return loadNativeLib();
}
