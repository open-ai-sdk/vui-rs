//! The native edit buffer behind `<input>`. Single-line for v0, but its public
//! op set (insert/delete/motion/cursor/value) is the interface a multi-line rope
//! would later implement — callers never touch the storage directly, so swapping
//! the backing store doesn't change the FFI or the paint pass.
//!
//! Text is stored as a `Vec` of grapheme clusters so cursor math is in graphemes
//! (emoji, ZWJ sequences, combining marks all move/delete as one unit) while
//! column math uses `unicode-width` on each cluster's leading codepoint — the same
//! width model the cell grid uses, so the painted cursor lands where the terminal
//! actually advances.

use crate::color::Rgba;
use crate::width::char_width;
use unicode_segmentation::UnicodeSegmentation;

/// Cursor motions, mirrored by the FFI `vui_edit_move` codes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Motion {
    Left,
    Right,
    WordLeft,
    WordRight,
    Home,
    End,
}

impl Motion {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Motion::Right,
            2 => Motion::WordLeft,
            3 => Motion::WordRight,
            4 => Motion::Home,
            5 => Motion::End,
            _ => Motion::Left,
        }
    }
}

/// A single-line editable text buffer with a grapheme-indexed cursor.
#[derive(Clone, Debug)]
pub struct EditBuffer {
    /// One entry per grapheme cluster, in order.
    graphemes: Vec<String>,
    /// Cursor position as a grapheme index in `0..=graphemes.len()`.
    cursor: usize,
    /// Maximum grapheme count; `None` is unbounded.
    max_length: Option<usize>,
    placeholder: String,
    /// Whether this input has focus — gates cursor rendering in the paint pass.
    pub focused: bool,
    pub cursor_color: Option<Rgba>,
    pub placeholder_color: Option<Rgba>,
}

impl Default for EditBuffer {
    fn default() -> Self {
        Self {
            graphemes: Vec::new(),
            cursor: 0,
            max_length: None,
            placeholder: String::new(),
            focused: false,
            cursor_color: None,
            placeholder_color: None,
        }
    }
}

impl EditBuffer {
    /// Insert `text` (segmented into graphemes) at the cursor, advancing it.
    /// Stops early when `max_length` is reached; control characters are dropped
    /// so a pasted newline/escape can't smear the single line or inject control.
    pub fn insert(&mut self, text: &str) {
        for g in text.graphemes(true) {
            if self.at_capacity() {
                break;
            }
            if is_control_grapheme(g) {
                continue;
            }
            self.graphemes.insert(self.cursor, g.to_string());
            self.cursor += 1;
        }
    }

    /// Delete the grapheme before the cursor (Backspace). No-op at the start.
    pub fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.cursor -= 1;
        self.graphemes.remove(self.cursor);
    }

    /// Delete the grapheme at the cursor (Delete/forward). No-op at the end.
    pub fn delete_forward(&mut self) {
        if self.cursor < self.graphemes.len() {
            self.graphemes.remove(self.cursor);
        }
    }

    pub fn apply_motion(&mut self, motion: Motion) {
        match motion {
            Motion::Left => self.cursor = self.cursor.saturating_sub(1),
            Motion::Right => self.cursor = (self.cursor + 1).min(self.graphemes.len()),
            Motion::Home => self.cursor = 0,
            Motion::End => self.cursor = self.graphemes.len(),
            Motion::WordLeft => self.cursor = self.word_boundary_left(),
            Motion::WordRight => self.cursor = self.word_boundary_right(),
        }
    }

    /// Replace the whole value (e.g. a v-model write) and clamp the cursor to the
    /// new end. Honors `max_length` by truncating overflow.
    pub fn set_value(&mut self, text: &str) {
        self.graphemes = text.graphemes(true).map(str::to_string).collect();
        if let Some(max) = self.max_length {
            self.graphemes.truncate(max);
        }
        self.cursor = self.cursor.min(self.graphemes.len());
    }

    pub fn value(&self) -> String {
        self.graphemes.concat()
    }

    pub fn set_cursor(&mut self, index: usize) {
        self.cursor = index.min(self.graphemes.len());
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn len(&self) -> usize {
        self.graphemes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.graphemes.is_empty()
    }

    pub fn set_max_length(&mut self, max: Option<usize>) {
        self.max_length = max;
        if let Some(max) = max {
            self.graphemes.truncate(max);
            self.cursor = self.cursor.min(self.graphemes.len());
        }
    }

    pub fn set_placeholder(&mut self, text: &str) {
        self.placeholder = text.to_string();
    }

    pub fn placeholder(&self) -> &str {
        &self.placeholder
    }

    /// Column the cursor sits at: the summed display width of every grapheme
    /// before it. Drives horizontal scroll + the painted cursor position.
    pub fn cursor_column(&self) -> usize {
        // Clamp defensively: every mutator already keeps `cursor` in range, but a
        // width-summing hot path should never panic if that invariant ever slips.
        let end = self.cursor.min(self.graphemes.len());
        self.graphemes[..end].iter().map(|g| grapheme_width(g)).sum()
    }

    /// Iterate `(grapheme, width)` pairs in order — the paint pass walks these to
    /// place glyphs with horizontal scroll without reaching into the storage.
    pub fn iter_graphemes(&self) -> impl Iterator<Item = (&str, usize)> {
        self.graphemes.iter().map(|g| (g.as_str(), grapheme_width(g)))
    }

    /// The grapheme the cursor sits on, or `None` at the end of the line — the
    /// glyph the paint pass draws inverted as the block cursor.
    pub fn cursor_grapheme(&self) -> Option<&str> {
        self.graphemes.get(self.cursor).map(String::as_str)
    }

    fn at_capacity(&self) -> bool {
        self.max_length.is_some_and(|max| self.graphemes.len() >= max)
    }

    /// Skip whitespace left of the cursor, then the run of non-whitespace.
    fn word_boundary_left(&self) -> usize {
        let mut i = self.cursor;
        while i > 0 && is_space(&self.graphemes[i - 1]) {
            i -= 1;
        }
        while i > 0 && !is_space(&self.graphemes[i - 1]) {
            i -= 1;
        }
        i
    }

    /// Skip the run of non-whitespace right of the cursor, then whitespace.
    fn word_boundary_right(&self) -> usize {
        let n = self.graphemes.len();
        let mut i = self.cursor;
        while i < n && !is_space(&self.graphemes[i]) {
            i += 1;
        }
        while i < n && is_space(&self.graphemes[i]) {
            i += 1;
        }
        i
    }
}

/// Display width of a grapheme cluster, measured on its leading codepoint (the
/// v0 width model), with a floor of 1 so a zero-width cluster still occupies a
/// cell rather than collapsing the cursor onto its neighbour.
fn grapheme_width(g: &str) -> usize {
    g.chars().next().map(char_width).unwrap_or(0).max(1)
}

fn is_space(g: &str) -> bool {
    g.chars().all(|c| c.is_whitespace())
}

/// A grapheme that is a single control codepoint (C0/DEL/C1). Such bytes are
/// never valid input text — dropping them keeps a pasted escape sequence from
/// entering the buffer.
fn is_control_grapheme(g: &str) -> bool {
    let mut chars = g.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => {
            let u = c as u32;
            u < 0x20 || u == 0x7f || (0x80..=0x9f).contains(&u)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buf(s: &str) -> EditBuffer {
        let mut b = EditBuffer::default();
        b.insert(s);
        b
    }

    #[test]
    fn insert_advances_cursor_and_builds_value() {
        let b = buf("hello");
        assert_eq!(b.value(), "hello");
        assert_eq!(b.cursor(), 5);
        assert_eq!(b.cursor_column(), 5);
    }

    #[test]
    fn backspace_and_delete_forward() {
        let mut b = buf("abc");
        b.backspace();
        assert_eq!(b.value(), "ab");
        b.apply_motion(Motion::Home);
        b.delete_forward();
        assert_eq!(b.value(), "b");
        // Backspace at start and delete at end are no-ops.
        b.apply_motion(Motion::Home);
        b.backspace();
        assert_eq!(b.value(), "b");
        b.apply_motion(Motion::End);
        b.delete_forward();
        assert_eq!(b.value(), "b");
    }

    #[test]
    fn left_right_home_end_motions() {
        let mut b = buf("abcd");
        b.apply_motion(Motion::Home);
        assert_eq!(b.cursor(), 0);
        b.apply_motion(Motion::Right);
        b.apply_motion(Motion::Right);
        assert_eq!(b.cursor(), 2);
        b.apply_motion(Motion::Left);
        assert_eq!(b.cursor(), 1);
        b.apply_motion(Motion::End);
        assert_eq!(b.cursor(), 4);
        // Clamp at both ends.
        b.apply_motion(Motion::Right);
        assert_eq!(b.cursor(), 4);
        b.apply_motion(Motion::Home);
        b.apply_motion(Motion::Left);
        assert_eq!(b.cursor(), 0);
    }

    #[test]
    fn word_motions_skip_runs_and_whitespace() {
        let mut b = buf("foo bar  baz");
        b.apply_motion(Motion::Home);
        b.apply_motion(Motion::WordRight); // -> start of "bar" (after "foo ")
        assert_eq!(b.cursor(), 4);
        b.apply_motion(Motion::WordRight); // -> start of "baz"
        assert_eq!(b.cursor(), 9);
        b.apply_motion(Motion::WordLeft); // back to start of "baz"... then "bar"
        assert_eq!(b.cursor(), 4);
        b.apply_motion(Motion::WordLeft);
        assert_eq!(b.cursor(), 0);
    }

    #[test]
    fn max_length_clamps_insert_and_set_value() {
        let mut b = EditBuffer::default();
        b.set_max_length(Some(3));
        b.insert("abcdef");
        assert_eq!(b.value(), "abc");
        b.set_value("xyz123");
        assert_eq!(b.value(), "xyz");
    }

    #[test]
    fn grapheme_clusters_move_and_delete_as_one() {
        // A ZWJ emoji family is one grapheme: one Right crosses it, one Backspace
        // removes the whole cluster.
        let family = "👩‍👩‍👧";
        let mut b = buf(family);
        assert_eq!(b.len(), 1);
        assert_eq!(b.cursor(), 1);
        b.apply_motion(Motion::Left);
        assert_eq!(b.cursor(), 0);
        b.apply_motion(Motion::Right);
        b.backspace();
        assert_eq!(b.value(), "");
    }

    #[test]
    fn wide_grapheme_cursor_column_counts_two() {
        let mut b = buf("世a");
        b.apply_motion(Motion::Home);
        assert_eq!(b.cursor_column(), 0);
        b.apply_motion(Motion::Right); // past the wide '世'
        assert_eq!(b.cursor_column(), 2);
        b.apply_motion(Motion::Right);
        assert_eq!(b.cursor_column(), 3);
    }

    #[test]
    fn control_characters_are_dropped_on_insert() {
        let mut b = EditBuffer::default();
        b.insert("a\x1b[2Jb\n");
        assert_eq!(b.value(), "a[2Jb"); // ESC and newline dropped, printable kept
    }

    #[test]
    fn set_value_clamps_cursor() {
        let mut b = buf("abcdef");
        assert_eq!(b.cursor(), 6);
        b.set_value("hi");
        assert_eq!(b.cursor(), 2);
        assert_eq!(b.value(), "hi");
    }
}
