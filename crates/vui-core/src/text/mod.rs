//! Native text subsystem for text buffers, wrapped views, and editor state.
//!
//! This is intentionally monospace-cell oriented: grapheme movement uses
//! `unicode-segmentation`, width uses the same `crate::width::char_width` source
//! as the rest of the renderer, and draw goes through `CellBuffer`.

pub mod edit_buffer;
pub mod editor_view;
pub mod rope;
pub mod text_buffer;
pub mod text_buffer_view;

pub use edit_buffer::{EditBuffer, EditMotion};
pub use editor_view::EditorView;
pub use rope::Rope;
pub use text_buffer::{StyledRun, TextBuffer};
pub use text_buffer_view::{TextBufferView, TextMeasure, WrapMode};

pub(crate) fn graphemes(s: &str) -> Vec<&str> {
    use unicode_segmentation::UnicodeSegmentation;
    s.graphemes(true).collect()
}

pub(crate) fn grapheme_width(g: &str) -> u32 {
    g.chars()
        .next()
        .map(crate::width::char_width)
        .unwrap_or(0)
        .max(1) as u32
}

pub(crate) fn str_width(s: &str) -> u32 {
    graphemes(s).into_iter().map(grapheme_width).sum()
}

pub(crate) fn byte_index_for_grapheme(s: &str, index: usize) -> usize {
    if index == 0 {
        return 0;
    }
    for (seen, (byte, _)) in
        unicode_segmentation::UnicodeSegmentation::grapheme_indices(s, true).enumerate()
    {
        if seen == index {
            return byte;
        }
    }
    s.len()
}

pub(crate) fn grapheme_count(s: &str) -> usize {
    unicode_segmentation::UnicodeSegmentation::graphemes(s, true).count()
}
