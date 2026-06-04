use crate::buffer::{CellBuffer, ClipRect};
use crate::color::Rgba;
use crate::text::{TextBuffer, grapheme_width, graphemes};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WrapMode {
    None,
    Char,
    Word,
}

impl WrapMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::None,
            1 => Self::Char,
            _ => Self::Word,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextMeasure {
    pub line_count: u32,
    pub max_width: u32,
}

#[derive(Clone, Debug)]
struct VisualCell {
    ch: char,
    width: u32,
    source: usize,
}

#[derive(Clone, Debug, Default)]
struct VisualLine {
    cells: Vec<VisualCell>,
    width: u32,
}

#[derive(Debug)]
pub struct TextBufferView {
    buffer: TextBuffer,
    width: u32,
    mode: WrapMode,
    cache_epoch: u64,
    cache_width: u32,
    cache_mode: WrapMode,
    virtual_lines: Vec<VisualLine>,
}

impl TextBufferView {
    pub fn new(buffer: &TextBuffer) -> Self {
        Self {
            buffer: buffer.clone(),
            width: u32::MAX,
            mode: WrapMode::Word,
            cache_epoch: 0,
            cache_width: 0,
            cache_mode: WrapMode::Word,
            virtual_lines: Vec::new(),
        }
    }

    pub fn set_width(&mut self, width: u32) {
        self.width = width.max(1);
    }

    pub fn set_wrap(&mut self, mode: WrapMode) {
        self.mode = mode;
    }

    pub fn measure(&mut self, width: u32, mode: WrapMode) -> TextMeasure {
        self.width = width.max(1);
        self.mode = mode;
        self.ensure_cache();
        TextMeasure {
            line_count: self.virtual_lines.len().max(1) as u32,
            max_width: self
                .virtual_lines
                .iter()
                .map(|line| line.width)
                .max()
                .unwrap_or(0),
        }
    }

    pub fn draw(
        &mut self,
        dst: &mut CellBuffer,
        x: i32,
        y: i32,
        fg: Rgba,
        bg: Option<Rgba>,
        attrs: u16,
        clip: ClipRect,
    ) {
        self.ensure_cache();
        for (row, line) in self.virtual_lines.iter().enumerate() {
            let mut col = 0i32;
            for cell in &line.cells {
                let dx = x + col;
                let dy = y + row as i32;
                if dx >= clip.x1 {
                    break;
                }
                let style = self.buffer.style_at(cell.source);
                let cell_fg = style.fg.unwrap_or(fg);
                let cell_bg = style.bg.or(bg).unwrap_or_else(|| {
                    dst.get_cell(dx.max(0) as u32, dy.max(0) as u32)
                        .map(|c| c.bg)
                        .unwrap_or(crate::buffer::DEFAULT_BG)
                });
                dst.set_cell_clipped(
                    dx,
                    dy,
                    cell.ch as u32,
                    cell_fg,
                    cell_bg,
                    attrs | style.attrs,
                    clip,
                );
                if cell.width == 2 {
                    dst.set_cell_clipped(
                        dx + 1,
                        dy,
                        0,
                        cell_fg,
                        cell_bg,
                        attrs | style.attrs | crate::buffer::attr::WIDE_CONTINUATION,
                        clip,
                    );
                }
                col += cell.width as i32;
            }
        }
    }

    pub fn visual_lines(&mut self) -> Vec<String> {
        self.ensure_cache();
        self.virtual_lines
            .iter()
            .map(|line| line.cells.iter().map(|cell| cell.ch).collect())
            .collect()
    }

    fn ensure_cache(&mut self) {
        let epoch = self.buffer.epoch();
        if self.cache_epoch == epoch
            && self.cache_width == self.width
            && self.cache_mode == self.mode
        {
            return;
        }
        let text = self.buffer.text();
        self.virtual_lines = wrap_visual_lines(&text, self.width, self.mode);
        self.cache_epoch = epoch;
        self.cache_width = self.width;
        self.cache_mode = self.mode;
    }
}

pub fn wrap_text(text: &str, width: u32, mode: WrapMode) -> Vec<String> {
    wrap_visual_lines(text, width, mode)
        .into_iter()
        .map(|line| line.cells.into_iter().map(|cell| cell.ch).collect())
        .collect()
}

fn wrap_visual_lines(text: &str, width: u32, mode: WrapMode) -> Vec<VisualLine> {
    let budget = width.max(1);
    let mut out = Vec::new();
    let mut source = 0usize;
    for physical in text.split('\n') {
        let cells = indexed_cells(physical, source);
        match mode {
            WrapMode::None => out.push(line_from_cells(cells)),
            WrapMode::Char => wrap_char_cells(cells, budget, &mut out),
            WrapMode::Word => wrap_word_cells(cells, budget, &mut out),
        }
        source += graphemes(physical).len() + 1;
    }
    if out.is_empty() {
        out.push(VisualLine::default());
    }
    out
}

fn indexed_cells(line: &str, source_offset: usize) -> Vec<VisualCell> {
    graphemes(line)
        .into_iter()
        .enumerate()
        .filter_map(|(i, g)| {
            let ch = g.chars().next()?;
            Some(VisualCell {
                ch,
                width: grapheme_width(g).max(1),
                source: source_offset + i,
            })
        })
        .collect()
}

fn line_from_cells(cells: Vec<VisualCell>) -> VisualLine {
    let width = cells.iter().map(|cell| cell.width).sum();
    VisualLine { cells, width }
}

fn wrap_char_cells(cells: Vec<VisualCell>, budget: u32, out: &mut Vec<VisualLine>) {
    let mut cur = Vec::new();
    let mut w = 0;
    for cell in cells {
        if !cur.is_empty() && w + cell.width > budget {
            out.push(VisualLine {
                cells: std::mem::take(&mut cur),
                width: w,
            });
            w = 0;
        }
        w += cell.width;
        cur.push(cell);
    }
    out.push(VisualLine {
        cells: cur,
        width: w,
    });
}

#[derive(Clone)]
struct Token {
    cells: Vec<VisualCell>,
    width: u32,
    is_space: bool,
}

fn wrap_word_cells(cells: Vec<VisualCell>, budget: u32, out: &mut Vec<VisualLine>) {
    let tokens = word_tokens(cells);
    let mut cur = Vec::new();
    let mut w = 0;
    let mut emitted_long_token = false;
    for token in tokens {
        if token.width > budget {
            if !cur.is_empty() {
                let (cells, width) = trim_trailing_space_cells(std::mem::take(&mut cur));
                out.push(VisualLine { cells, width });
                w = 0;
            }
            wrap_char_cells(token.cells, budget, out);
            emitted_long_token = true;
            continue;
        }
        if !cur.is_empty() && w + token.width > budget {
            let (cells, width) = trim_trailing_space_cells(std::mem::take(&mut cur));
            out.push(VisualLine { cells, width });
            w = 0;
        }
        if cur.is_empty() && token.is_space {
            continue;
        }
        w += token.width;
        cur.extend(token.cells);
        emitted_long_token = false;
    }
    if cur.is_empty() && emitted_long_token {
        return;
    }
    let (cells, width) = trim_trailing_space_cells(cur);
    out.push(VisualLine { cells, width });
}

fn word_tokens(cells: Vec<VisualCell>) -> Vec<Token> {
    let mut out = Vec::new();
    let mut cur = Vec::new();
    let mut cur_space: Option<bool> = None;
    for cell in cells {
        let is_space = cell.ch.is_whitespace();
        if cur_space.is_some_and(|s| s != is_space) {
            out.push(token_from_cells(
                std::mem::take(&mut cur),
                cur_space.unwrap(),
            ));
        }
        cur_space = Some(is_space);
        cur.push(cell);
    }
    if !cur.is_empty() {
        out.push(token_from_cells(cur, cur_space.unwrap_or(false)));
    }
    out
}

fn token_from_cells(cells: Vec<VisualCell>, is_space: bool) -> Token {
    let width = cells.iter().map(|cell| cell.width).sum();
    Token {
        cells,
        width,
        is_space,
    }
}

fn trim_trailing_space_cells(mut cells: Vec<VisualCell>) -> (Vec<VisualCell>, u32) {
    while cells.last().is_some_and(|cell| cell.ch.is_whitespace()) {
        cells.pop();
    }
    let width = cells.iter().map(|cell| cell.width).sum();
    (cells, width)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{CellBuffer, DEFAULT_BG, DEFAULT_FG};
    use crate::color::Rgba;
    use crate::text::StyledRun;

    #[test]
    fn word_wrap_prefers_word_boundaries_with_char_fallback() {
        let lines = wrap_text("hello world abcdef", 6, WrapMode::Word);
        assert_eq!(lines, vec!["hello", "world", "abcdef"]);
        let long = wrap_text("abcdefg", 3, WrapMode::Word);
        assert_eq!(long, vec!["abc", "def", "g"]);
    }

    #[test]
    fn measure_and_draw_read_same_virtual_lines() {
        let buf = TextBuffer::from("hello world");
        let mut view = TextBufferView::new(&buf);
        let m = view.measure(5, WrapMode::Word);
        assert_eq!(m.line_count, 2);
        let mut cells = CellBuffer::new(8, 3);
        view.draw(
            &mut cells,
            0,
            0,
            DEFAULT_FG,
            Some(DEFAULT_BG),
            0,
            ClipRect {
                x0: 0,
                y0: 0,
                x1: 8,
                y1: 3,
            },
        );
        assert_eq!(cells.cells[0].ch, 'h' as u32);
        assert_eq!(cells.cells[8].ch, 'w' as u32);
    }

    #[test]
    fn draw_preserves_styled_run_boundaries_after_wrap() {
        let mut buf = TextBuffer::new();
        let red = Rgba::new(255, 0, 0, 255);
        let green = Rgba::new(0, 255, 0, 255);
        buf.set_styled_runs([
            StyledRun {
                text: "ab",
                fg: Some(red),
                bg: None,
                attrs: 0,
            },
            StyledRun {
                text: "cd",
                fg: Some(green),
                bg: None,
                attrs: crate::buffer::attr::BOLD,
            },
        ]);
        let mut view = TextBufferView::new(&buf);
        view.measure(3, WrapMode::Char);
        let mut cells = CellBuffer::new(4, 2);
        view.draw(
            &mut cells,
            0,
            0,
            DEFAULT_FG,
            Some(DEFAULT_BG),
            0,
            ClipRect {
                x0: 0,
                y0: 0,
                x1: 4,
                y1: 2,
            },
        );
        assert_eq!(cells.cells[0].fg, red);
        assert_eq!(cells.cells[2].fg, green);
        assert_eq!(
            cells.cells[2].attrs & crate::buffer::attr::BOLD,
            crate::buffer::attr::BOLD
        );
    }
}
