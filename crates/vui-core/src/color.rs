//! RGBA color: the FFI wire format is a packed `0xRRGGBBAA` u32, decoded into a
//! `#[repr(C)]` struct that lives inside every `Cell`. Keeping the struct
//! `repr(C)` lets Bun build a zero-copy typed-array view over the cell buffer.
//!
//! Color *strings* never cross the FFI boundary — the TS side resolves them to a
//! packed u32 before sending. The string parser here ([`parse`]/[`named`]) is the
//! reference implementation kept in parity with `packages/core/src/color.ts`; a
//! parity test asserts both languages map the same string to the same value. The
//! named-color table is the single shared source `packages/core/src/color-names.json`.

use std::collections::HashMap;
use std::sync::LazyLock;

/// 8-bit-per-channel color with alpha. Alpha is carried for completeness; v0
/// rendering always emits truecolor and treats every cell as opaque.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// Decode a packed `0xRRGGBBAA` value (the FFI color encoding).
    pub const fn from_packed(v: u32) -> Self {
        Self {
            r: (v >> 24) as u8,
            g: (v >> 16) as u8,
            b: (v >> 8) as u8,
            a: v as u8,
        }
    }

    /// Encode back to `0xRRGGBBAA`.
    pub const fn to_packed(self) -> u32 {
        (self.r as u32) << 24 | (self.g as u32) << 16 | (self.b as u32) << 8 | (self.a as u32)
    }
}

/// The shared named-color table (`name` → packed `0xRRGGBBAA`), parsed once from
/// the JSON that the TS side also reads, so the two never drift.
static NAMED_COLORS: LazyLock<HashMap<String, u32>> = LazyLock::new(|| {
    const JSON: &str = include_str!("../../../packages/core/src/color-names.json");
    parse_color_table(JSON)
});

/// Named CSS color (curated subset) → `Rgba`, or `None` if unknown. Case-insensitive.
pub fn named(name: &str) -> Option<Rgba> {
    NAMED_COLORS
        .get(&name.to_ascii_lowercase())
        .map(|&packed| Rgba::from_packed(packed))
}

/// Parse a color string the same way the TS `parseColor` does: `#rgb`/`#rrggbb`/
/// `#rrggbbaa`, `rgb()/rgba()` functional notation, or a named color. Whitespace
/// is trimmed; names are case-insensitive. Returns `None` for anything malformed.
pub fn parse(value: &str) -> Option<Rgba> {
    let v = value.trim();
    if let Some(hex) = v.strip_prefix('#') {
        return parse_hex(hex).map(Rgba::from_packed);
    }
    if v.starts_with("rgb") {
        return parse_rgb_function(v);
    }
    named(v)
}

/// Parse the hex body (no `#`): 3, 6, or 8 hex digits → packed `0xRRGGBBAA`.
fn parse_hex(body: &str) -> Option<u32> {
    let expanded = match body.len() {
        3 => body.chars().flat_map(|c| [c, c]).collect::<String>() + "ff",
        6 => format!("{body}ff"),
        8 => body.to_string(),
        _ => return None,
    };
    u32::from_str_radix(&expanded, 16).ok()
}

/// `rgb(r,g,b)` / `rgba(r,g,b,a)`; channels 0–255, alpha 0–255 or a 0–1 fraction.
fn parse_rgb_function(value: &str) -> Option<Rgba> {
    let open = value.find('(')?;
    let inner = value.strip_suffix(')')?.get(open + 1..)?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    if parts.len() < 3 || parts.len() > 4 {
        return None;
    }
    let r = channel(parts[0])?;
    let g = channel(parts[1])?;
    let b = channel(parts[2])?;
    let a = match parts.get(3) {
        None => 255,
        Some(s) => {
            let raw = decimal(s)?;
            clamp255(if raw <= 1.0 { (raw * 255.0).round() } else { raw.round() })
        }
    };
    Some(Rgba::new(r, g, b, a))
}

fn channel(s: &str) -> Option<u8> {
    Some(clamp255(decimal(s)?.round()))
}

/// Parse a finite decimal channel value. `f64::parse` also accepts `inf`/`nan`;
/// reject those so the grammar matches the TS side exactly (color parity).
fn decimal(s: &str) -> Option<f64> {
    let n: f64 = s.parse().ok()?;
    n.is_finite().then_some(n)
}

fn clamp255(n: f64) -> u8 {
    n.clamp(0.0, 255.0) as u8
}

/// Minimal parser for the flat `{ "name": "#rrggbb", … }` color table. The file
/// is repo-controlled and never nested, so collecting quoted strings pairwise
/// (key, value, key, value, …) is enough — no JSON dependency needed.
fn parse_color_table(json: &str) -> HashMap<String, u32> {
    let mut strings = Vec::new();
    let bytes = json.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && bytes[j] != b'"' {
                j += 1;
            }
            strings.push(&json[start..j]);
            i = j + 1;
        } else {
            i += 1;
        }
    }
    let mut map = HashMap::new();
    for pair in strings.chunks_exact(2) {
        let (name, hex) = (pair[0], pair[1]);
        let body = hex.strip_prefix('#').expect("color-names.json value must start with #");
        let packed = parse_hex(body).expect("color-names.json has a bad hex value");
        map.insert(name.to_ascii_lowercase(), packed);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packed_round_trips() {
        let c = Rgba::new(0x12, 0x34, 0x56, 0x78);
        assert_eq!(c.to_packed(), 0x1234_5678);
        assert_eq!(Rgba::from_packed(0x1234_5678), c);
    }

    #[test]
    fn opaque_red_decodes() {
        assert_eq!(Rgba::from_packed(0xFF00_00FF), Rgba::new(255, 0, 0, 255));
    }

    #[test]
    fn named_known_and_unknown() {
        assert_eq!(named("black"), Some(Rgba::new(0, 0, 0, 255)));
        assert_eq!(named("red"), Some(Rgba::new(255, 0, 0, 255)));
        assert_eq!(named("RoyalBlue"), named("royalblue")); // case-insensitive
        assert!(named("chartreuse").is_none());
    }

    #[test]
    fn parses_hex_forms() {
        assert_eq!(parse("#f00"), Some(Rgba::new(255, 0, 0, 255)));
        assert_eq!(parse("#00ff00"), Some(Rgba::new(0, 255, 0, 255)));
        assert_eq!(parse("#0000ff80"), Some(Rgba::new(0, 0, 255, 0x80)));
        assert_eq!(parse("  #abc  "), Some(Rgba::new(0xaa, 0xbb, 0xcc, 255)));
        assert!(parse("#xyz").is_none());
        assert!(parse("#12").is_none());
    }

    #[test]
    fn parses_rgb_function() {
        assert_eq!(parse("rgb(13, 188, 121)"), Some(Rgba::new(13, 188, 121, 255)));
        assert_eq!(parse("rgba(255,0,0,0.5)"), Some(Rgba::new(255, 0, 0, 128)));
        assert_eq!(parse("rgba(0,0,0,128)"), Some(Rgba::new(0, 0, 0, 128)));
        assert_eq!(parse("rgb(300, -5, 10)"), Some(Rgba::new(255, 0, 10, 255))); // clamped
        assert_eq!(parse("rgb(1e2, 0, 0)"), Some(Rgba::new(100, 0, 0, 255))); // exponent form
        assert!(parse("rgb(1,2)").is_none());
        assert!(parse("rgb(a,b,c)").is_none());
        // Malformed channels — kept in parity with the TS parser (color.ts).
        assert!(parse("rgb(1,2,)").is_none()); // empty channel
        assert!(parse("rgb(0x10,0,0)").is_none()); // hex channel
        assert!(parse("rgba(0,0,0,)").is_none()); // empty alpha
        assert!(parse("rgb(inf,0,0)").is_none()); // non-finite
        assert!(parse("rgb(nan,0,0)").is_none());
    }

    #[test]
    fn parses_named() {
        assert_eq!(parse("teal"), Some(Rgba::new(0, 128, 128, 255)));
        assert_eq!(parse("transparent"), Some(Rgba::new(0, 0, 0, 0)));
        assert!(parse("definitelynotacolor").is_none());
    }

    #[test]
    fn table_loaded_from_shared_json() {
        // The whole curated table must load (catches a JSON/parse-table regression).
        assert!(NAMED_COLORS.len() >= 30);
        assert_eq!(NAMED_COLORS.get("gold"), Some(&0xffd700ffu32));
    }
}
