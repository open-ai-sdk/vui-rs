//! RGBA color: the FFI wire format is a packed `0xRRGGBBAA` u32, decoded into a
//! `#[repr(C)]` struct that lives inside every `Cell`. Keeping the struct
//! `repr(C)` lets Bun build a zero-copy typed-array view over the cell buffer.

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

/// Basic 16-color ANSI palette, returned as opaque `Rgba`. A convenience for
/// examples and tests; the renderer itself only ever sees `Rgba`.
pub fn named(name: &str) -> Option<Rgba> {
    let c = match name {
        "black" => (0, 0, 0),
        "red" => (205, 49, 49),
        "green" => (13, 188, 121),
        "yellow" => (229, 229, 16),
        "blue" => (36, 114, 200),
        "magenta" => (188, 63, 188),
        "cyan" => (17, 168, 205),
        "white" => (229, 229, 229),
        "bright-black" => (102, 102, 102),
        "bright-red" => (241, 76, 76),
        "bright-green" => (35, 209, 139),
        "bright-yellow" => (245, 245, 67),
        "bright-blue" => (59, 142, 234),
        "bright-magenta" => (214, 112, 214),
        "bright-cyan" => (41, 184, 219),
        "bright-white" => (255, 255, 255),
        _ => return None,
    };
    Some(Rgba::new(c.0, c.1, c.2, 255))
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
        assert!(named("chartreuse").is_none());
    }
}
