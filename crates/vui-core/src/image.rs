//! Inline-image decode + aspect-preserving fit. The only place the `image` crate
//! is touched, so a codec/version change stays local. The JS host hands a path and
//! a target pixel box (derived from the `<image>`'s cell rect × cell pixel size);
//! we decode, fit inside the box keeping aspect, and return RGBA8 the host either
//! turns into half-block cells or base64-transmits to a graphics-capable terminal.

use image::imageops::FilterType;

/// A decoded, fitted image as tightly-packed RGBA8 (`width * height * 4` bytes).
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Fit a decoded image inside `max_w` × `max_h` pixels (aspect preserved; the
/// result may be smaller on the non-binding axis). A zero max means "don't resize".
fn fit(img: image::DynamicImage, max_w: u32, max_h: u32) -> DecodedImage {
    let fitted = if max_w > 0 && max_h > 0 {
        // `resize` fits WITHIN the box preserving aspect (never upscales past it
        // on the binding axis); Lanczos3 keeps downscaled photos crisp.
        img.resize(max_w, max_h, FilterType::Lanczos3)
    } else {
        img
    };
    let rgba = fitted.to_rgba8();
    DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    }
}

/// Decode `path` from disk and fit it. Returns `None` on any decode/read error
/// (the host renders nothing).
pub fn decode_and_fit(path: &str, max_w: u32, max_h: u32) -> Option<DecodedImage> {
    Some(fit(image::open(path).ok()?, max_w, max_h))
}

/// Decode an image from in-memory bytes (format auto-detected) and fit it. Used
/// for remote/fetched images the host already has as a byte buffer. `None` on a
/// decode error.
pub fn decode_and_fit_bytes(bytes: &[u8], max_w: u32, max_h: u32) -> Option<DecodedImage> {
    Some(fit(image::load_from_memory(bytes).ok()?, max_w, max_h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, codecs::png::PngEncoder};
    use std::io::Cursor;

    /// Encode a tiny solid-red PNG to a temp file and return its path.
    fn write_red_png(w: u32, h: u32) -> std::path::PathBuf {
        let mut buf = Vec::new();
        let pixels = vec![255u8; (w * h * 4) as usize]; // opaque white… set red below
        let mut rgba = pixels;
        for px in rgba.chunks_exact_mut(4) {
            px[0] = 200;
            px[1] = 10;
            px[2] = 20;
            px[3] = 255;
        }
        PngEncoder::new(Cursor::new(&mut buf))
            .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
            .unwrap();
        let dir = std::env::temp_dir();
        let path = dir.join(format!("vui-img-test-{}x{}.png", w, h));
        std::fs::write(&path, &buf).unwrap();
        path
    }

    #[test]
    fn decodes_png_to_rgba() {
        let path = write_red_png(4, 2);
        let img = decode_and_fit(path.to_str().unwrap(), 0, 0).unwrap();
        assert_eq!(img.width, 4);
        assert_eq!(img.height, 2);
        assert_eq!(img.rgba.len(), 4 * 2 * 4);
        assert_eq!(&img.rgba[0..4], &[200, 10, 20, 255]);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn fit_preserves_aspect_within_box() {
        let path = write_red_png(40, 20); // 2:1
        // Fit into a 10×10 box → width binds, height halves to keep aspect.
        let img = decode_and_fit(path.to_str().unwrap(), 10, 10).unwrap();
        assert_eq!(img.width, 10);
        assert_eq!(img.height, 5);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn missing_file_returns_none() {
        assert!(decode_and_fit("/no/such/file.png", 0, 0).is_none());
    }

    #[test]
    fn decodes_from_memory_bytes() {
        // Build a 4×2 red PNG in memory, then decode it straight from bytes.
        let mut buf = Vec::new();
        let mut rgba = vec![0u8; 4 * 2 * 4];
        for px in rgba.chunks_exact_mut(4) {
            px.copy_from_slice(&[200, 10, 20, 255]);
        }
        PngEncoder::new(Cursor::new(&mut buf))
            .write_image(&rgba, 4, 2, image::ExtendedColorType::Rgba8)
            .unwrap();
        let img = decode_and_fit_bytes(&buf, 0, 0).unwrap();
        assert_eq!((img.width, img.height), (4, 2));
        assert_eq!(&img.rgba[0..4], &[200, 10, 20, 255]);
        // Garbage bytes decode to None.
        assert!(decode_and_fit_bytes(b"not an image", 0, 0).is_none());
    }
}
