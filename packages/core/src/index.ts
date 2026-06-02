import { loadNativeLib } from "./native/load-native-lib.ts";

export { symbols, EXPECTED_ABI_VERSION } from "./native/load-native-lib.ts";
export type { NativeLib } from "./native/load-native-lib.ts";

/**
 * Memoized handle to the loaded vui-core native library. The first call
 * resolves, opens, and ABI-checks the library; subsequent calls reuse it.
 */
export function getNativeLib() {
  return loadNativeLib();
}
