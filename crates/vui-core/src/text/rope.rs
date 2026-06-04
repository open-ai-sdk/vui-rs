use crate::text::{byte_index_for_grapheme, grapheme_count};

/// A compact rope facade for v1 text editing.
///
/// The public operations are grapheme-indexed and keep undo/redo snapshots in
/// native memory. The internals are deliberately simple for this first Rust port;
/// the surrounding buffer/view/editor layers do not depend on a flat string and
/// can absorb a chunked rope later without changing the FFI contract.
#[derive(Clone, Debug, Default)]
pub struct Rope {
    text: String,
    undo: Vec<String>,
    redo: Vec<String>,
}

impl Rope {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            undo: Vec::new(),
            redo: Vec::new(),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }

    pub fn set_text(&mut self, text: impl Into<String>) {
        self.snapshot();
        self.text = text.into();
    }

    pub fn set_text_no_history(&mut self, text: impl Into<String>) {
        self.text = text.into();
        self.redo.clear();
    }

    pub fn len_graphemes(&self) -> usize {
        grapheme_count(&self.text)
    }

    pub fn line_count(&self) -> usize {
        self.text.bytes().filter(|b| *b == b'\n').count() + 1
    }

    pub fn insert(&mut self, index: usize, text: &str) {
        if text.is_empty() {
            return;
        }
        self.snapshot();
        self.insert_no_history(index, text);
    }

    pub fn insert_no_history(&mut self, index: usize, text: &str) {
        if text.is_empty() {
            return;
        }
        let at = byte_index_for_grapheme(&self.text, index.min(self.len_graphemes()));
        self.text.insert_str(at, text);
        self.redo.clear();
    }

    pub fn delete(&mut self, start: usize, end: usize) {
        let lo = start.min(end).min(self.len_graphemes());
        let hi = start.max(end).min(self.len_graphemes());
        if lo == hi {
            return;
        }
        self.snapshot();
        self.delete_no_history(lo, hi);
    }

    pub fn delete_no_history(&mut self, start: usize, end: usize) {
        let lo = start.min(end).min(self.len_graphemes());
        let hi = start.max(end).min(self.len_graphemes());
        if lo == hi {
            return;
        }
        let b0 = byte_index_for_grapheme(&self.text, lo);
        let b1 = byte_index_for_grapheme(&self.text, hi);
        self.text.replace_range(b0..b1, "");
        self.redo.clear();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self) -> bool {
        let Some(prev) = self.undo.pop() else {
            return false;
        };
        self.redo.push(std::mem::replace(&mut self.text, prev));
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        self.undo.push(std::mem::replace(&mut self.text, next));
        true
    }

    pub fn clear_redo(&mut self) {
        self.redo.clear();
    }

    fn snapshot(&mut self) {
        self.undo.push(self.text.clone());
        self.redo.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_delete_are_grapheme_indexed() {
        let mut r = Rope::from("a世b");
        r.insert(2, "🦀");
        assert_eq!(r.as_str(), "a世🦀b");
        r.delete(1, 3);
        assert_eq!(r.as_str(), "ab");
    }

    #[test]
    fn undo_redo_restore_text() {
        let mut r = Rope::from("one");
        r.insert(3, "\ntwo");
        assert_eq!(r.line_count(), 2);
        assert!(r.undo());
        assert_eq!(r.as_str(), "one");
        assert!(r.redo());
        assert_eq!(r.as_str(), "one\ntwo");
    }
}
