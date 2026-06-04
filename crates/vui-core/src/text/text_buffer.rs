use crate::color::Rgba;
use crate::text::{Rope, grapheme_count};
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Debug)]
struct TextBufferInner {
    rope: Rope,
    content_epoch: u64,
    styles: Vec<StyledSpan>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StyledSpan {
    pub start: usize,
    pub end: usize,
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub attrs: u16,
}

#[derive(Clone, Copy, Debug)]
pub struct StyledRun<'a> {
    pub text: &'a str,
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub attrs: u16,
}

/// Shared native text buffer handle.
///
/// Views clone this handle, so freeing the public FFI `TextBuffer` wrapper cannot
/// leave a `TextBufferView` with a dangling pointer. This is single-threaded
/// shared ownership, matching the Bun FFI host.
#[derive(Clone, Debug)]
pub struct TextBuffer {
    inner: Rc<RefCell<TextBufferInner>>,
}

impl Default for TextBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl TextBuffer {
    pub fn new() -> Self {
        Self {
            inner: Rc::new(RefCell::new(TextBufferInner {
                rope: Rope::new(),
                content_epoch: 1,
                styles: Vec::new(),
            })),
        }
    }

    pub fn from(text: impl Into<String>) -> Self {
        let text = text.into();
        let len = grapheme_count(&text);
        Self {
            inner: Rc::new(RefCell::new(TextBufferInner {
                rope: Rope::from(text),
                content_epoch: 1,
                styles: default_styles(len),
            })),
        }
    }

    pub fn text(&self) -> String {
        self.inner.borrow().rope.as_str().to_string()
    }

    pub fn with_text<R>(&self, f: impl FnOnce(&str) -> R) -> R {
        let inner = self.inner.borrow();
        f(inner.rope.as_str())
    }

    pub fn epoch(&self) -> u64 {
        self.inner.borrow().content_epoch
    }

    pub fn set_text(&mut self, text: impl Into<String>) {
        let text = text.into();
        let len = grapheme_count(&text);
        let mut inner = self.inner.borrow_mut();
        inner.rope.set_text(text);
        inner.styles = default_styles(len);
        bump(&mut inner);
    }

    pub fn set_text_no_history(&mut self, text: impl Into<String>) {
        let text = text.into();
        let len = grapheme_count(&text);
        let mut inner = self.inner.borrow_mut();
        inner.rope.set_text_no_history(text);
        inner.styles = default_styles(len);
        bump(&mut inner);
    }

    pub fn set_styled_runs<'a>(&mut self, runs: impl IntoIterator<Item = StyledRun<'a>>) {
        let mut text = String::new();
        let mut styles = Vec::new();
        let mut cursor = 0usize;
        for run in runs {
            let len = grapheme_count(run.text);
            text.push_str(run.text);
            if len > 0 {
                styles.push(StyledSpan {
                    start: cursor,
                    end: cursor + len,
                    fg: run.fg,
                    bg: run.bg,
                    attrs: run.attrs,
                });
            }
            cursor += len;
        }
        let mut inner = self.inner.borrow_mut();
        inner.rope.set_text_no_history(text);
        inner.styles = if styles.is_empty() {
            default_styles(cursor)
        } else {
            styles
        };
        bump(&mut inner);
    }

    pub fn insert(&mut self, at: usize, text: &str) {
        let mut inner = self.inner.borrow_mut();
        inner.rope.insert(at, text);
        inner.styles = default_styles(inner.rope.len_graphemes());
        bump(&mut inner);
    }

    pub fn insert_no_history(&mut self, at: usize, text: &str) {
        let mut inner = self.inner.borrow_mut();
        inner.rope.insert_no_history(at, text);
        inner.styles = default_styles(inner.rope.len_graphemes());
        bump(&mut inner);
    }

    pub fn delete(&mut self, start: usize, end: usize) {
        let mut inner = self.inner.borrow_mut();
        inner.rope.delete(start, end);
        inner.styles = default_styles(inner.rope.len_graphemes());
        bump(&mut inner);
    }

    pub fn delete_no_history(&mut self, start: usize, end: usize) {
        let mut inner = self.inner.borrow_mut();
        inner.rope.delete_no_history(start, end);
        inner.styles = default_styles(inner.rope.len_graphemes());
        bump(&mut inner);
    }

    pub fn line_count(&self) -> usize {
        self.with_text(|text| text.bytes().filter(|b| *b == b'\n').count() + 1)
    }

    pub fn len_graphemes(&self) -> usize {
        self.with_text(grapheme_count)
    }

    pub fn can_undo(&self) -> bool {
        self.inner.borrow().rope.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.inner.borrow().rope.can_redo()
    }

    pub fn undo(&mut self) -> bool {
        let mut inner = self.inner.borrow_mut();
        let changed = inner.rope.undo();
        if changed {
            inner.styles = default_styles(inner.rope.len_graphemes());
            bump(&mut inner);
        }
        changed
    }

    pub fn redo(&mut self) -> bool {
        let mut inner = self.inner.borrow_mut();
        let changed = inner.rope.redo();
        if changed {
            inner.styles = default_styles(inner.rope.len_graphemes());
            bump(&mut inner);
        }
        changed
    }

    pub fn style_at(&self, offset: usize) -> StyledSpan {
        self.inner
            .borrow()
            .styles
            .iter()
            .find(|span| offset >= span.start && offset < span.end)
            .cloned()
            .unwrap_or(StyledSpan {
                start: offset,
                end: offset.saturating_add(1),
                fg: None,
                bg: None,
                attrs: 0,
            })
    }
}

fn bump(inner: &mut TextBufferInner) {
    inner.content_epoch = inner.content_epoch.wrapping_add(1).max(1);
}

fn default_styles(len: usize) -> Vec<StyledSpan> {
    if len == 0 {
        Vec::new()
    } else {
        vec![StyledSpan {
            start: 0,
            end: len,
            fg: None,
            bg: None,
            attrs: 0,
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_changes_on_content_edits() {
        let mut b = TextBuffer::from("a");
        let e = b.epoch();
        b.insert(1, "b");
        assert_eq!(b.text(), "ab");
        assert!(b.epoch() > e);
    }

    #[test]
    fn cloned_handles_share_content() {
        let mut a = TextBuffer::from("a");
        let b = a.clone();
        a.insert(1, "b");
        assert_eq!(b.text(), "ab");
    }
}
