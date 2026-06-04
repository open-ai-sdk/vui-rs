use crate::text::{TextBuffer, byte_index_for_grapheme, grapheme_count, grapheme_width, graphemes};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditMotion {
    Left,
    Right,
    WordLeft,
    WordRight,
    Home,
    End,
    Up,
    Down,
    DocStart,
    DocEnd,
}

impl EditMotion {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Right,
            2 => Self::WordLeft,
            3 => Self::WordRight,
            4 => Self::Home,
            5 => Self::End,
            6 => Self::Up,
            7 => Self::Down,
            8 => Self::DocStart,
            9 => Self::DocEnd,
            _ => Self::Left,
        }
    }
}

#[derive(Clone, Debug)]
struct Snapshot {
    text: String,
    cursor: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EditGroup {
    Typing,
    Delete,
    Newline,
}

#[derive(Debug)]
struct EditBufferInner {
    buffer: TextBuffer,
    cursor: usize,
    desired_col: u32,
    selection_anchor: Option<usize>,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    group: Option<EditGroup>,
}

/// Shared native edit buffer handle.
///
/// `EditorView` clones this handle, so view drawing remains memory-safe even if
/// the public FFI edit-buffer wrapper is freed before the editor-view wrapper.
#[derive(Clone, Debug)]
pub struct EditBuffer {
    inner: Rc<RefCell<EditBufferInner>>,
}

impl Default for EditBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl EditBuffer {
    pub fn new() -> Self {
        Self {
            inner: Rc::new(RefCell::new(EditBufferInner {
                buffer: TextBuffer::new(),
                cursor: 0,
                desired_col: 0,
                selection_anchor: None,
                undo: Vec::new(),
                redo: Vec::new(),
                group: None,
            })),
        }
    }

    pub fn buffer(&self) -> TextBuffer {
        self.inner.borrow().buffer.clone()
    }

    pub fn value(&self) -> String {
        self.inner.borrow().buffer.text()
    }

    pub fn set_value(&mut self, text: impl Into<String>) {
        let mut inner = self.inner.borrow_mut();
        inner.buffer.set_text_no_history(text.into());
        inner.cursor = inner.buffer.len_graphemes();
        inner.desired_col = line_col_for_offset(&inner.buffer.text(), inner.cursor).1;
        inner.selection_anchor = None;
        inner.undo.clear();
        inner.redo.clear();
        inner.group = None;
    }

    pub fn insert_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut inner = self.inner.borrow_mut();
        inner.snapshot(EditGroup::Typing);
        inner.delete_selection_inner();
        let cursor = inner.cursor;
        inner.buffer.insert_no_history(cursor, text);
        inner.cursor += grapheme_count(text);
        inner.update_desired_col();
    }

    pub fn newline(&mut self) {
        let mut inner = self.inner.borrow_mut();
        inner.snapshot(EditGroup::Newline);
        inner.delete_selection_inner();
        let cursor = inner.cursor;
        inner.buffer.insert_no_history(cursor, "\n");
        inner.cursor += 1;
        inner.update_desired_col();
        inner.group = None;
    }

    pub fn backspace(&mut self) {
        let mut inner = self.inner.borrow_mut();
        if inner.delete_selection() || inner.cursor == 0 {
            return;
        }
        inner.snapshot(EditGroup::Delete);
        let cursor = inner.cursor;
        inner.buffer.delete_no_history(cursor - 1, cursor);
        inner.cursor -= 1;
        inner.update_desired_col();
        inner.group = None;
    }

    pub fn delete(&mut self) {
        let mut inner = self.inner.borrow_mut();
        if inner.delete_selection() || inner.cursor >= inner.buffer.len_graphemes() {
            return;
        }
        inner.snapshot(EditGroup::Delete);
        let cursor = inner.cursor;
        inner.buffer.delete_no_history(cursor, cursor + 1);
        inner.update_desired_col();
        inner.group = None;
    }

    pub fn select_all(&mut self) {
        let mut inner = self.inner.borrow_mut();
        inner.selection_anchor = Some(0);
        inner.cursor = inner.buffer.len_graphemes();
        inner.update_desired_col();
    }

    pub fn has_selection(&self) -> bool {
        self.inner.borrow().selection_range().is_some()
    }

    pub fn selected_text(&self) -> String {
        let inner = self.inner.borrow();
        let Some((start, end)) = inner.selection_range() else {
            return String::new();
        };
        let value = inner.buffer.text();
        let start_byte = byte_index_for_grapheme(&value, start);
        let end_byte = byte_index_for_grapheme(&value, end);
        value[start_byte..end_byte].to_string()
    }

    pub fn delete_selection(&mut self) -> bool {
        let mut inner = self.inner.borrow_mut();
        inner.delete_selection()
    }

    pub fn move_cursor(&mut self, motion: EditMotion, selecting: bool) {
        let mut inner = self.inner.borrow_mut();
        inner.move_cursor(motion, selecting);
    }

    pub fn move_to_offset(&mut self, offset: usize, selecting: bool) {
        let mut inner = self.inner.borrow_mut();
        inner.move_to_offset(offset, selecting);
    }

    pub fn cursor_row_col(&self) -> (u32, u32) {
        let inner = self.inner.borrow();
        line_col_for_offset(&inner.buffer.text(), inner.cursor)
    }

    pub fn cursor_offset(&self) -> usize {
        self.inner.borrow().cursor
    }

    pub fn can_undo(&self) -> bool {
        !self.inner.borrow().undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.inner.borrow().redo.is_empty()
    }

    pub fn undo(&mut self) -> bool {
        let mut inner = self.inner.borrow_mut();
        inner.undo()
    }

    pub fn redo(&mut self) -> bool {
        let mut inner = self.inner.borrow_mut();
        inner.redo()
    }
}

impl EditBufferInner {
    fn value(&self) -> String {
        self.buffer.text()
    }

    fn move_cursor(&mut self, motion: EditMotion, selecting: bool) {
        let old = self.cursor;
        let value = self.value();
        self.cursor = match motion {
            EditMotion::Left => self.cursor.saturating_sub(1),
            EditMotion::Right => (self.cursor + 1).min(self.buffer.len_graphemes()),
            EditMotion::WordLeft => word_left(&value, self.cursor),
            EditMotion::WordRight => word_right(&value, self.cursor),
            EditMotion::Home => offset_from_line_col(&value, self.cursor_row(), 0),
            EditMotion::End => line_end_offset(&value, self.cursor),
            EditMotion::Up => {
                let (row, _) = line_col_for_offset(&value, self.cursor);
                offset_from_line_col(&value, row.saturating_sub(1), self.desired_col)
            }
            EditMotion::Down => {
                let (row, _) = line_col_for_offset(&value, self.cursor);
                offset_from_line_col(&value, row + 1, self.desired_col)
            }
            EditMotion::DocStart => 0,
            EditMotion::DocEnd => self.buffer.len_graphemes(),
        };
        if selecting {
            if self.selection_anchor.is_none() {
                self.selection_anchor = Some(old);
            }
        } else {
            self.selection_anchor = None;
        }
        if !matches!(motion, EditMotion::Up | EditMotion::Down) {
            self.update_desired_col();
        }
        self.group = None;
    }

    fn undo(&mut self) -> bool {
        let Some(prev) = self.undo.pop() else {
            return false;
        };
        self.redo.push(Snapshot {
            text: self.value(),
            cursor: self.cursor,
        });
        self.buffer.set_text_no_history(prev.text);
        self.cursor = prev.cursor.min(self.buffer.len_graphemes());
        self.selection_anchor = None;
        self.update_desired_col();
        self.group = None;
        true
    }

    fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        self.undo.push(Snapshot {
            text: self.value(),
            cursor: self.cursor,
        });
        self.buffer.set_text_no_history(next.text);
        self.cursor = next.cursor.min(self.buffer.len_graphemes());
        self.selection_anchor = None;
        self.update_desired_col();
        self.group = None;
        true
    }

    fn cursor_row(&self) -> u32 {
        line_col_for_offset(&self.buffer.text(), self.cursor).0
    }

    fn snapshot(&mut self, group: EditGroup) {
        if self.group == Some(group) && group == EditGroup::Typing {
            return;
        }
        self.undo.push(Snapshot {
            text: self.value(),
            cursor: self.cursor,
        });
        self.redo.clear();
        self.group = Some(group);
    }

    fn delete_selection(&mut self) -> bool {
        if self.selection_range().is_none() {
            return false;
        }
        self.snapshot(EditGroup::Delete);
        self.delete_selection_inner();
        self.group = None;
        true
    }

    fn delete_selection_inner(&mut self) {
        if let Some((start, end)) = self.selection_range() {
            self.buffer.delete_no_history(start, end);
            self.cursor = start;
            self.selection_anchor = None;
        }
    }

    fn move_to_offset(&mut self, offset: usize, selecting: bool) {
        let old = self.cursor;
        self.cursor = offset.min(self.buffer.len_graphemes());
        if selecting {
            if self.selection_anchor.is_none() {
                self.selection_anchor = Some(old);
            }
        } else {
            self.selection_anchor = None;
        }
        self.update_desired_col();
        self.group = None;
    }

    fn selection_range(&self) -> Option<(usize, usize)> {
        let a = self.selection_anchor?;
        if a == self.cursor {
            None
        } else {
            Some((a.min(self.cursor), a.max(self.cursor)))
        }
    }

    fn update_desired_col(&mut self) {
        self.desired_col = line_col_for_offset(&self.buffer.text(), self.cursor).1;
    }
}

fn word_left(text: &str, cursor: usize) -> usize {
    let gs = graphemes(text);
    let mut c = cursor.min(gs.len());
    while c > 0 && gs[c - 1].trim().is_empty() {
        c -= 1;
    }
    while c > 0 && !gs[c - 1].trim().is_empty() {
        c -= 1;
    }
    c
}

fn word_right(text: &str, cursor: usize) -> usize {
    let gs = graphemes(text);
    let mut c = cursor.min(gs.len());
    while c < gs.len() && gs[c].trim().is_empty() {
        c += 1;
    }
    while c < gs.len() && !gs[c].trim().is_empty() {
        c += 1;
    }
    c
}

fn line_end_offset(text: &str, cursor: usize) -> usize {
    let gs = graphemes(text);
    let mut c = cursor.min(gs.len());
    while c < gs.len() && gs[c] != "\n" {
        c += 1;
    }
    c
}

pub fn line_col_for_offset(text: &str, offset: usize) -> (u32, u32) {
    let mut row = 0;
    let mut col = 0;
    for (i, g) in graphemes(text).into_iter().enumerate() {
        if i >= offset {
            break;
        }
        if g == "\n" {
            row += 1;
            col = 0;
        } else {
            col += grapheme_width(g);
        }
    }
    (row, col)
}

pub fn offset_from_line_col(text: &str, wanted_row: u32, wanted_col: u32) -> usize {
    let gs = graphemes(text);
    let mut row = 0;
    let mut col = 0;
    let mut last_on_row = 0;
    for (i, g) in gs.iter().enumerate() {
        if row == wanted_row {
            if *g == "\n" || col >= wanted_col {
                return i;
            }
            last_on_row = i + 1;
        }
        if *g == "\n" {
            if row == wanted_row {
                return i;
            }
            row += 1;
            col = 0;
            last_on_row = i + 1;
        } else if row == wanted_row {
            col += grapheme_width(g);
        }
    }
    if row == wanted_row {
        last_on_row
    } else {
        gs.len()
    }
}

pub fn byte_index_for_cursor(text: &str, cursor: usize) -> usize {
    byte_index_for_grapheme(text, cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_burst_undoes_as_one_step() {
        let mut e = EditBuffer::new();
        e.insert_text("a");
        e.insert_text("b");
        e.insert_text("世");
        assert_eq!(e.value(), "ab世");
        assert!(e.undo());
        assert_eq!(e.value(), "");
        assert!(e.redo());
        assert_eq!(e.value(), "ab世");
    }

    #[test]
    fn set_value_resets_history() {
        let mut e = EditBuffer::new();
        e.insert_text("draft");
        assert!(e.can_undo());
        e.set_value("saved");
        assert_eq!(e.value(), "saved");
        assert!(!e.can_undo());
        assert!(!e.buffer().can_undo());
        assert!(!e.undo());
    }

    #[test]
    fn cloned_handles_share_content() {
        let mut e = EditBuffer::new();
        let clone = e.clone();
        e.insert_text("shared");
        assert_eq!(clone.value(), "shared");
    }

    #[test]
    fn moves_by_line_and_word() {
        let mut e = EditBuffer::new();
        e.insert_text("one two\nthree");
        e.move_cursor(EditMotion::DocStart, false);
        e.move_cursor(EditMotion::WordRight, false);
        assert_eq!(e.cursor_offset(), 3);
        e.move_cursor(EditMotion::End, false);
        assert_eq!(e.cursor_offset(), 7);
        e.move_cursor(EditMotion::Down, false);
        assert_eq!(e.cursor_row_col(), (1, 5));
    }
}
