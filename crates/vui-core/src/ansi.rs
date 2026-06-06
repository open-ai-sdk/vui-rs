//! ANSI escape builders. Every byte the renderer puts on the wire that is *not*
//! glyph content originates here, so terminal control is auditable in one place
//! and user text can never be interpreted as an escape (ANSI-injection safety).
//!
//! Builders append into a reused `Vec<u8>`; writing to a `Vec` is infallible, so
//! the `write!` results are intentionally discarded.

use crate::buffer::attr;
use crate::color::Rgba;
use std::io::Write;

/// Begin synchronized output: the terminal buffers everything until the matching
/// `sync_end`, then presents the frame atomically (no tearing). CSI ?2026h.
pub fn sync_begin(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?2026h");
}

/// End synchronized output. CSI ?2026l.
pub fn sync_end(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?2026l");
}

pub fn hide_cursor(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?25l");
}

pub fn show_cursor(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[?25h");
}

/// Reset all SGR state (color + attributes). CSI 0m.
pub fn reset(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b[0m");
}

/// Move the cursor to a zero-based `(x, y)`, emitting the 1-based CSI form
/// `ESC [ row ; col H`.
pub fn move_to(out: &mut Vec<u8>, x: u32, y: u32) {
    let _ = write!(out, "\x1b[{};{}H", y + 1, x + 1);
}

/// Truecolor foreground: `ESC [ 38;2;r;g;b m`.
pub fn fg(out: &mut Vec<u8>, c: Rgba) {
    let _ = write!(out, "\x1b[38;2;{};{};{}m", c.r, c.g, c.b);
}

/// Truecolor background: `ESC [ 48;2;r;g;b m`.
pub fn bg(out: &mut Vec<u8>, c: Rgba) {
    let _ = write!(out, "\x1b[48;2;{};{};{}m", c.r, c.g, c.b);
}

/// Emit SGR codes for the set attribute flags. Only "on" codes are written, so
/// the caller MUST emit `reset` first whenever the previous state had any
/// attribute set — otherwise a stale attribute (e.g. bold) would persist. The
/// renderer satisfies this by always resetting before re-emitting the pen.
pub fn attributes(out: &mut Vec<u8>, attrs: u16) {
    if attrs & attr::BOLD != 0 {
        out.extend_from_slice(b"\x1b[1m");
    }
    if attrs & attr::DIM != 0 {
        out.extend_from_slice(b"\x1b[2m");
    }
    if attrs & attr::ITALIC != 0 {
        out.extend_from_slice(b"\x1b[3m");
    }
    if attrs & attr::UNDERLINE != 0 {
        out.extend_from_slice(b"\x1b[4m");
    }
    if attrs & attr::INVERSE != 0 {
        out.extend_from_slice(b"\x1b[7m");
    }
    if attrs & attr::STRIKETHROUGH != 0 {
        out.extend_from_slice(b"\x1b[9m");
    }
}

/// Append `s` with every byte that could break out of an OSC string removed (C0
/// controls, DEL, and bytes ≥ 0x7f's C1 range start). OSC 8 URIs are host-staged
/// but originate from user content (markdown hrefs), so sanitizing here keeps the
/// "user data can never inject terminal control" invariant for the link channel,
/// exactly as `safe_glyph` does for cell text.
fn sanitize_osc(s: &str, out: &mut Vec<u8>) {
    for &b in s.as_bytes() {
        // Keep printable ASCII + UTF-8 continuation/lead bytes (≥ 0xa0); drop C0,
        // DEL, and the C1 control range (0x80..=0x9f) lead bytes can't be — UTF-8
        // multibyte sequences start ≥ 0xc2, so this only strips genuine controls.
        if (0x20..0x7f).contains(&b) || b >= 0xa0 {
            out.push(b);
        }
    }
}

/// Open an OSC 8 hyperlink: `ESC ] 8 ; ; <uri> ST`. Cells emitted until the next
/// `osc8_close` are part of the link.
pub fn osc8_open(out: &mut Vec<u8>, uri: &str) {
    out.extend_from_slice(b"\x1b]8;;");
    sanitize_osc(uri, out);
    out.extend_from_slice(b"\x1b\\");
}

/// Close the current OSC 8 hyperlink: `ESC ] 8 ; ; ST`.
pub fn osc8_close(out: &mut Vec<u8>) {
    out.extend_from_slice(b"\x1b]8;;\x1b\\");
}

/// The Kitty graphics protocol's "rowcolumn diacritics" — combining marks that
/// encode a Unicode-placeholder cell's image row/column. `DIACRITICS[n]` is the
/// mark for index `n`. Cell (row r, col c) of an image is the placeholder char
/// `U+10EEEE` followed by `DIACRITICS[r]` then `DIACRITICS[c]`. This is the head of
/// the canonical list (kitty's `graphics.py`); 200 entries cover any image sized to
/// a terminal grid (≤ 200 cells per axis). Indices past the table reuse the last
/// mark (a benign visual artifact only for images larger than any real terminal).
pub const KITTY_PLACEHOLDER: u32 = 0x0010_EEEE;
const DIACRITICS: &[u32] = &[
    0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A, 0x034B, 0x034C,
    0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
    0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
    0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059C, 0x059D, 0x059E, 0x059F, 0x05A0, 0x05A1,
    0x05A8, 0x05A9, 0x05AB, 0x05AC, 0x05AF, 0x05C4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
    0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065A, 0x065B, 0x065D, 0x065E, 0x06D6, 0x06D7, 0x06D8,
    0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E4, 0x06E7, 0x06E8, 0x06EB,
    0x06EC, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073A, 0x073D, 0x073F, 0x0740, 0x0741, 0x0743,
    0x0745, 0x0747, 0x0749, 0x074A, 0x07EB, 0x07EC, 0x07ED, 0x07EE, 0x07EF, 0x07F0, 0x07F1, 0x07F3,
    0x0816, 0x0817, 0x0818, 0x0819, 0x081B, 0x081C, 0x081D, 0x081E, 0x081F, 0x0820, 0x0821, 0x0822,
    0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082A, 0x082B, 0x082C, 0x082D, 0x0951, 0x0953, 0x0954,
    0x0F82, 0x0F83, 0x0F86, 0x0F87, 0x135D, 0x135E, 0x135F, 0x17DD, 0x193A, 0x1A17, 0x1A75, 0x1A76,
    0x1A77, 0x1A78, 0x1A79, 0x1A7A, 0x1A7B, 0x1A7C, 0x1B6B, 0x1B6D, 0x1B6E, 0x1B6F, 0x1B70, 0x1B71,
    0x1B72, 0x1B73, 0x1CD0, 0x1CD1, 0x1CD2, 0x1CDA, 0x1CDB, 0x1CE0, 0x1DC0, 0x1DC1, 0x1DC3, 0x1DC4,
    0x1DC5, 0x1DC6, 0x1DC7, 0x1DC8, 0x1DC9, 0x1DCB, 0x1DCC, 0x1DD1, 0x1DD2, 0x1DD3, 0x1DD4, 0x1DD5,
    0x1DD6, 0x1DD7, 0x1DD8, 0x1DD9, 0x1DDA, 0x1DDB, 0x1DDC, 0x1DDD, 0x1DDE, 0x1DDF, 0x1DE0, 0x1DE1,
    0x1DE2, 0x1DE3, 0x1DE4, 0x1DE5, 0x1DE6, 0x1DFE,
];

/// The diacritic codepoint encoding index `n` (clamped to the table's last entry).
fn diacritic(n: usize) -> char {
    let cp = DIACRITICS[n.min(DIACRITICS.len() - 1)];
    char::from_u32(cp).unwrap_or('\u{0305}')
}

/// Emit a Kitty Unicode-placeholder cell for image (row, col): the placeholder
/// char followed by the row then column diacritic. The caller emits the image-id
/// foreground color (truecolor) just before this, per the protocol.
pub fn kitty_placeholder(out: &mut Vec<u8>, row: usize, col: usize) {
    let mut utf8 = [0u8; 4];
    out.extend_from_slice(
        char::from_u32(KITTY_PLACEHOLDER)
            .unwrap()
            .encode_utf8(&mut utf8)
            .as_bytes(),
    );
    out.extend_from_slice(diacritic(row).encode_utf8(&mut utf8).as_bytes());
    out.extend_from_slice(diacritic(col).encode_utf8(&mut utf8).as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_to_is_one_based() {
        let mut o = Vec::new();
        move_to(&mut o, 0, 0);
        assert_eq!(o, b"\x1b[1;1H");
        o.clear();
        move_to(&mut o, 4, 2);
        assert_eq!(o, b"\x1b[3;5H");
    }

    #[test]
    fn truecolor_codes() {
        let mut o = Vec::new();
        fg(&mut o, Rgba::new(10, 20, 30, 255));
        bg(&mut o, Rgba::new(1, 2, 3, 255));
        assert_eq!(o, b"\x1b[38;2;10;20;30m\x1b[48;2;1;2;3m");
    }

    #[test]
    fn attribute_codes() {
        let mut o = Vec::new();
        attributes(&mut o, attr::BOLD | attr::UNDERLINE);
        assert_eq!(o, b"\x1b[1m\x1b[4m");
    }
}
