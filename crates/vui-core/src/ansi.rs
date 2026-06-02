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
