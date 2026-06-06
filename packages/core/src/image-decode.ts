// Thin wrapper over the native image decoder. Decodes a file to fitted RGBA8 and
// copies the pixels into a JS-owned `Uint8Array` so the native handle can be freed
// immediately (no lingering native allocation per cached image on the host side).
import { type Pointer, toArrayBuffer } from "bun:ffi";
import { loadNativeLib } from "./native/load-native-lib.ts";

export interface DecodedImage {
  width: number;
  height: number;
  /** Tightly-packed RGBA8, `width * height * 4` bytes (JS-owned copy). */
  rgba: Uint8Array;
}

/**
 * Decode `path` and fit within `maxW`×`maxH` pixels (aspect preserved; 0 = no
 * resize). Returns null on any decode/read error so callers render nothing. The
 * native handle is freed before returning — the pixels are copied out.
 */
export function decodeImage(path: string, maxW = 0, maxH = 0): DecodedImage | null {
  const bytes = new TextEncoder().encode(path);
  return readHandle((lib) => lib.symbols.vui_image_decode(bytes, bytes.byteLength, maxW, maxH));
}

/**
 * Decode an image from in-memory bytes (format auto-detected) and fit within
 * `maxW`×`maxH` px. For remote/fetched images the host already has as a buffer.
 * Returns null on any decode error.
 */
export function decodeImageBytes(bytes: Uint8Array, maxW = 0, maxH = 0): DecodedImage | null {
  return readHandle((lib) =>
    lib.symbols.vui_image_decode_bytes(bytes, bytes.byteLength, maxW, maxH),
  );
}

/** Run a decode that yields a native handle, copy its RGBA out, and free it. */
function readHandle(
  decode: (lib: ReturnType<typeof loadNativeLib>) => Pointer | null,
): DecodedImage | null {
  const lib = loadNativeLib();
  const handle = decode(lib);
  if (handle === null) return null;
  try {
    const width = lib.symbols.vui_image_width(handle);
    const height = lib.symbols.vui_image_height(handle);
    const ptr = lib.symbols.vui_image_rgba_ptr(handle) as Pointer | null;
    const len = Number(lib.symbols.vui_image_rgba_len(handle));
    if (ptr === null || len === 0) return null;
    // Copy out of native memory so the handle can be freed now.
    const rgba = new Uint8Array(toArrayBuffer(ptr, 0, len)).slice();
    return { width, height, rgba };
  } finally {
    lib.symbols.vui_image_free(handle);
  }
}
