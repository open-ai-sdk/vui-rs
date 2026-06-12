use crate::buffer::{CellBuffer, ClipRect, DEFAULT_FG, attr};
use crate::color::Rgba;
use crate::text::text_buffer_view::{WrapMode, wrap_text, wrap_visual_lines};
use crate::text::{EditBuffer, EditMotion, TextMeasure, grapheme_width, graphemes, str_width};

#[derive(Debug)]
pub struct EditorView {
    edit: EditBuffer,
    width: u32,
    height: u32,
    wrap: WrapMode,
    scroll_y: u32,
    focused: bool,
    cursor_visible: bool,
    desired_visual_col: Option<u32>,
    /// Half-open grapheme-offset ranges painted in `highlight_fg` (e.g. `$skill`
    /// tokens). Offsets share the cursor's model (newlines count as 1 grapheme).
    highlights: Vec<(u32, u32)>,
    highlight_fg: Rgba,
}

impl EditorView {
    pub fn new(edit: &EditBuffer, width: u32, height: u32) -> Self {
        Self {
            edit: edit.clone(),
            width: width.max(1),
            height: height.max(1),
            wrap: WrapMode::Word,
            scroll_y: 0,
            focused: false,
            cursor_visible: true,
            desired_visual_col: None,
            highlights: Vec::new(),
            highlight_fg: DEFAULT_FG,
        }
    }

    /// Set the grapheme-offset ranges to paint in `color` (replaces any prior set).
    /// Pass an empty `ranges` to clear highlighting.
    pub fn set_highlights(&mut self, ranges: Vec<(u32, u32)>, color: Rgba) {
        self.highlights = ranges;
        self.highlight_fg = color;
    }

    fn highlight_contains(&self, offset: usize) -> bool {
        let offset = offset as u32;
        self.highlights
            .iter()
            .any(|&(start, end)| offset >= start && offset < end)
    }

    pub fn set_wrap(&mut self, mode: WrapMode) {
        self.wrap = mode;
    }

    pub fn set_viewport(&mut self, width: u32, height: u32) {
        self.width = width.max(1);
        self.height = height.max(1);
    }

    pub fn set_focused(&mut self, focused: bool) {
        self.focused = focused;
    }

    pub fn set_cursor_visible(&mut self, visible: bool) {
        self.cursor_visible = visible;
    }

    pub fn measure(&self, width: u32, mode: WrapMode) -> TextMeasure {
        let lines = wrap_text(&self.edit.value(), width.max(1), mode);
        TextMeasure {
            line_count: lines.len().max(1) as u32,
            max_width: lines.iter().map(|line| str_width(line)).max().unwrap_or(0),
        }
    }

    pub fn move_cursor(&mut self, motion: EditMotion, selecting: bool) {
        match motion {
            EditMotion::Up | EditMotion::Down => {
                let value = self.edit.value();
                let (row, col) =
                    visual_cursor_for(&value, self.edit.cursor_offset(), self.width, self.wrap);
                let desired_col = self.desired_visual_col.unwrap_or(col);
                let target_row = if motion == EditMotion::Up {
                    row.saturating_sub(1)
                } else {
                    row.saturating_add(1)
                };
                let offset = offset_for_visual_cursor(
                    &value,
                    target_row,
                    desired_col,
                    self.width,
                    self.wrap,
                );
                self.edit.move_to_offset(offset, selecting);
                self.desired_visual_col = Some(desired_col);
                self.ensure_cursor_visible();
            }
            _ => {
                self.edit.move_cursor(motion, selecting);
                self.desired_visual_col = None;
                self.ensure_cursor_visible();
            }
        }
    }

    pub fn draw(
        &mut self,
        dst: &mut CellBuffer,
        x: i32,
        y: i32,
        fg: Rgba,
        bg: Rgba,
        cursor_bg: Rgba,
        attrs: u16,
        clip: ClipRect,
    ) {
        if self.focused {
            self.ensure_cursor_visible();
        }
        let value = self.edit.value();
        // Paint cell-by-cell (mirrors `TextBufferView::draw`) so each grapheme can take
        // the accent fg when its source offset falls inside a highlight range. With no
        // highlights this is equivalent to the prior `draw_text_clipped` per line —
        // `wrap_text`/`wrap_visual_lines` already collapse each cell to its first char.
        let lines = wrap_visual_lines(&value, self.width, self.wrap);
        for row in 0..self.height as usize {
            let Some(line) = lines.get(self.scroll_y as usize + row) else {
                break;
            };
            let dy = y + row as i32;
            let mut col = 0i32;
            for cell in &line.cells {
                let dx = x + col;
                if dx >= clip.x1 {
                    break;
                }
                let cell_fg = if self.highlight_contains(cell.source) {
                    self.highlight_fg
                } else {
                    fg
                };
                dst.set_cell_clipped(dx, dy, cell.ch as u32, cell_fg, bg, attrs, clip);
                if cell.width == 2 {
                    dst.set_cell_clipped(
                        dx + 1,
                        dy,
                        0,
                        cell_fg,
                        bg,
                        attrs | attr::WIDE_CONTINUATION,
                        clip,
                    );
                }
                col += cell.width as i32;
            }
        }
        if self.focused && self.cursor_visible {
            let (cy, cx) = self.visual_cursor();
            if cy >= self.scroll_y && cy < self.scroll_y + self.height {
                dst.set_cell_clipped(
                    x + cx as i32,
                    y + (cy - self.scroll_y) as i32,
                    cursor_char(&value, self.edit.cursor_offset()) as u32,
                    bg,
                    cursor_bg,
                    attrs,
                    clip,
                );
            }
        }
    }

    fn ensure_cursor_visible(&mut self) {
        let (row, _) = self.visual_cursor();
        if row < self.scroll_y {
            self.scroll_y = row;
        } else if row >= self.scroll_y + self.height {
            self.scroll_y = row.saturating_sub(self.height - 1);
        }
    }

    fn visual_cursor(&self) -> (u32, u32) {
        visual_cursor_for(
            &self.edit.value(),
            self.edit.cursor_offset(),
            self.width,
            self.wrap,
        )
    }
}

fn cursor_char(text: &str, cursor: usize) -> char {
    graphemes(text)
        .get(cursor)
        .and_then(|g| g.chars().next())
        .filter(|ch| grapheme_width(&ch.to_string()) > 0)
        .unwrap_or(' ')
}

fn visual_cursor_for(text: &str, cursor: usize, width: u32, mode: WrapMode) -> (u32, u32) {
    let mut global = 0usize;
    let mut visual_row = 0u32;
    for physical in text.split('\n') {
        let len = graphemes(physical).len();
        if cursor <= global + len {
            let local = cursor.saturating_sub(global);
            let (row, col) = cursor_in_wrapped_line(physical, local, width, mode);
            return (visual_row + row, col);
        }
        visual_row += wrap_text(physical, width, mode).len().max(1) as u32;
        global += len + 1;
    }
    (visual_row, 0)
}

fn cursor_in_wrapped_line(line: &str, cursor: usize, width: u32, mode: WrapMode) -> (u32, u32) {
    if mode == WrapMode::None {
        return (0, grapheme_prefix_width(line, 0, cursor));
    }
    let spans = wrap_spans(line, width.max(1), mode);
    if spans.is_empty() {
        return (0, 0);
    }
    for (row, span) in spans.iter().enumerate() {
        if cursor < span.start {
            return (row as u32, 0);
        }
        if cursor <= span.end {
            return (row as u32, grapheme_prefix_width(line, span.start, cursor));
        }
    }
    let row = spans.len() - 1;
    (row as u32, spans[row].width)
}

fn offset_for_visual_cursor(
    text: &str,
    target_row: u32,
    col: u32,
    width: u32,
    mode: WrapMode,
) -> usize {
    let mut global = 0usize;
    let mut visual_row = 0u32;
    let mut last_offset = 0usize;
    for physical in text.split('\n') {
        let spans = wrap_spans(physical, width.max(1), mode);
        for span in spans {
            if visual_row == target_row {
                return global + offset_in_span_for_col(physical, span.start, span.end, col);
            }
            visual_row = visual_row.saturating_add(1);
        }
        global += graphemes(physical).len() + 1;
        last_offset = global.saturating_sub(1);
    }
    last_offset.min(graphemes(text).len())
}

fn offset_in_span_for_col(line: &str, start: usize, end: usize, col: u32) -> usize {
    let gs = graphemes(line);
    let mut width = 0u32;
    let end = end.min(gs.len());
    for (i, g) in gs[start.min(gs.len())..end].iter().enumerate() {
        let gw = grapheme_width(g);
        if width + gw > col {
            return start + i;
        }
        width += gw;
    }
    end
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Span {
    start: usize,
    end: usize,
    width: u32,
}

fn wrap_spans(line: &str, width: u32, mode: WrapMode) -> Vec<Span> {
    match mode {
        WrapMode::None => vec![Span {
            start: 0,
            end: graphemes(line).len(),
            width: str_width(line),
        }],
        WrapMode::Char => char_spans(line, 0, width),
        WrapMode::Word => word_spans(line, width),
    }
}

fn char_spans(text: &str, start_offset: usize, width: u32) -> Vec<Span> {
    let gs = graphemes(text);
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut end = 0usize;
    let mut w = 0u32;
    for (i, g) in gs.iter().enumerate() {
        let gw = grapheme_width(g);
        if end > start && w + gw > width {
            out.push(Span {
                start: start_offset + start,
                end: start_offset + end,
                width: w,
            });
            start = i;
            end = i;
            w = 0;
        }
        end += 1;
        w += gw;
    }
    out.push(Span {
        start: start_offset + start,
        end: start_offset + end,
        width: w,
    });
    out
}

fn word_spans(line: &str, width: u32) -> Vec<Span> {
    let tokens = word_tokens_with_offsets(line);
    let mut out = Vec::new();
    let mut cur: Option<Span> = None;
    for token in tokens {
        if token.width > width {
            if let Some(span) = cur.take() {
                out.push(span);
            }
            out.extend(char_spans(&token.text, token.start, width));
            continue;
        }
        match cur {
            Some(span) if span.width + token.width > width => {
                out.push(trimmed_span(line, span));
                cur = if token.is_space {
                    None
                } else {
                    Some(Span {
                        start: token.start,
                        end: token.end,
                        width: token.width,
                    })
                };
            }
            Some(mut span) => {
                span.end = token.end;
                span.width += token.width;
                cur = Some(span);
            }
            None => {
                cur = Some(Span {
                    start: token.start,
                    end: token.end,
                    width: token.width,
                });
            }
        }
    }
    if let Some(span) = cur {
        out.push(span);
    }
    if out.is_empty() {
        out.push(Span {
            start: 0,
            end: 0,
            width: 0,
        });
    }
    out
}

#[derive(Debug)]
struct Token {
    text: String,
    start: usize,
    end: usize,
    width: u32,
    is_space: bool,
}

fn word_tokens_with_offsets(line: &str) -> Vec<Token> {
    let gs = graphemes(line);
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut start = 0usize;
    let mut cur_space: Option<bool> = None;
    for (i, g) in gs.iter().enumerate() {
        let is_space = g.chars().all(char::is_whitespace);
        if cur_space.is_some_and(|s| s != is_space) {
            out.push(Token {
                width: str_width(&cur),
                text: std::mem::take(&mut cur),
                start,
                end: i,
                is_space: cur_space.unwrap(),
            });
            start = i;
        }
        cur_space = Some(is_space);
        cur.push_str(g);
    }
    if !cur.is_empty() {
        out.push(Token {
            width: str_width(&cur),
            text: cur,
            start,
            end: gs.len(),
            is_space: cur_space.unwrap_or(false),
        });
    }
    out
}

fn trimmed_span(line: &str, mut span: Span) -> Span {
    let gs = graphemes(line);
    if !gs[span.start.min(gs.len())..span.end.min(gs.len())]
        .iter()
        .any(|g| !g.chars().all(char::is_whitespace))
    {
        return span;
    }
    while span.end > span.start && gs[span.end - 1].chars().all(char::is_whitespace) {
        span.end -= 1;
    }
    span.width = grapheme_range_width(&gs, span.start, span.end);
    span
}

fn grapheme_prefix_width(line: &str, start: usize, end: usize) -> u32 {
    let gs = graphemes(line);
    grapheme_range_width(&gs, start.min(gs.len()), end.min(gs.len()))
}

fn grapheme_range_width(gs: &[&str], start: usize, end: usize) -> u32 {
    gs[start.min(gs.len())..end.min(gs.len())]
        .iter()
        .map(|g| grapheme_width(g))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_wrapped_cursor_uses_word_wrap_boundaries() {
        // "a bc" wraps as ["a", "bc"] at width 3. Cursor before "b" belongs
        // at the start of visual row 1, not row 0 col 2.
        assert_eq!(visual_cursor_for("a bc", 2, 3, WrapMode::Word), (1, 0));
    }

    #[test]
    fn word_wrapped_cursor_preserves_trailing_spaces() {
        assert_eq!(visual_cursor_for("abc  ", 5, 10, WrapMode::Word), (0, 5));
    }

    #[test]
    fn word_wrapped_cursor_preserves_space_only_lines() {
        assert_eq!(visual_cursor_for("  ", 2, 10, WrapMode::Word), (0, 2));
    }

    #[test]
    fn editor_vertical_motion_uses_soft_wrapped_rows() {
        let mut edit = EditBuffer::new();
        edit.set_value("abcdef");
        edit.move_cursor(EditMotion::DocStart, false);
        let mut view = EditorView::new(&edit, 3, 2);
        view.set_wrap(WrapMode::Char);
        view.move_cursor(EditMotion::Down, false);
        assert_eq!(edit.cursor_offset(), 3);
        view.move_cursor(EditMotion::Up, false);
        assert_eq!(edit.cursor_offset(), 0);
    }

    #[test]
    fn editor_view_survives_owner_edit_handle_drop() {
        let mut edit = EditBuffer::new();
        edit.insert_text("one two");
        let mut view = EditorView::new(&edit, 4, 2);
        drop(edit);
        let mut dst = CellBuffer::new(8, 2);
        view.draw(
            &mut dst,
            0,
            0,
            crate::buffer::DEFAULT_FG,
            crate::buffer::DEFAULT_BG,
            crate::buffer::DEFAULT_FG,
            0,
            ClipRect {
                x0: 0,
                y0: 0,
                x1: 8,
                y1: 2,
            },
        );
        assert_eq!(dst.cells[0].ch, 'o' as u32);
    }

    #[test]
    fn draw_paints_highlight_ranges_in_accent_fg() {
        let base = crate::buffer::DEFAULT_FG;
        let accent = Rgba::new(0, 200, 255, 255);
        let mut edit = EditBuffer::new();
        // "go $skill" — grapheme offsets 3..9 cover "$skill".
        edit.insert_text("go $skill");
        let mut view = EditorView::new(&edit, 20, 1);
        view.set_wrap(WrapMode::None);
        view.set_highlights(vec![(3, 9)], accent);
        let mut dst = CellBuffer::new(20, 1);
        view.draw(
            &mut dst,
            0,
            0,
            base,
            crate::buffer::DEFAULT_BG,
            base,
            0,
            ClipRect {
                x0: 0,
                y0: 0,
                x1: 20,
                y1: 1,
            },
        );
        // "go " stays base fg; "$skill" takes the accent fg.
        assert_eq!(dst.cells[0].ch, 'g' as u32);
        assert_eq!(dst.cells[0].fg, base);
        assert_eq!(dst.cells[2].fg, base); // the space before the token
        assert_eq!(dst.cells[3].ch, '$' as u32);
        assert_eq!(dst.cells[3].fg, accent);
        assert_eq!(dst.cells[8].ch, 'l' as u32);
        assert_eq!(dst.cells[8].fg, accent);
    }

    #[test]
    fn draw_without_highlights_keeps_uniform_fg() {
        let base = crate::buffer::DEFAULT_FG;
        let mut edit = EditBuffer::new();
        edit.insert_text("plain text");
        let mut view = EditorView::new(&edit, 20, 1);
        view.set_wrap(WrapMode::None);
        let mut dst = CellBuffer::new(20, 1);
        view.draw(
            &mut dst,
            0,
            0,
            base,
            crate::buffer::DEFAULT_BG,
            base,
            0,
            ClipRect {
                x0: 0,
                y0: 0,
                x1: 20,
                y1: 1,
            },
        );
        assert_eq!(dst.cells[0].ch, 'p' as u32);
        for i in 0..10 {
            assert_eq!(dst.cells[i].fg, base);
        }
    }
}
