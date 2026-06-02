//! Box-drawing glyph sets for node borders. Pure data + a lookup; the actual
//! cell writes (with clipping) live in `paint.rs`. Keeping the glyphs here means
//! adding a border style is a one-line table edit.

use crate::node::BorderStyle;

/// The six glyphs that draw a rectangular frame: four corners, a horizontal run,
/// and a vertical run.
#[derive(Clone, Copy, Debug)]
pub struct BorderGlyphs {
    pub top_left: char,
    pub top_right: char,
    pub bottom_left: char,
    pub bottom_right: char,
    pub horizontal: char,
    pub vertical: char,
}

/// Resolve the glyph set for a border style.
pub fn glyphs(style: BorderStyle) -> BorderGlyphs {
    match style {
        BorderStyle::Single => BorderGlyphs {
            top_left: '┌',
            top_right: '┐',
            bottom_left: '└',
            bottom_right: '┘',
            horizontal: '─',
            vertical: '│',
        },
        BorderStyle::Double => BorderGlyphs {
            top_left: '╔',
            top_right: '╗',
            bottom_left: '╚',
            bottom_right: '╝',
            horizontal: '═',
            vertical: '║',
        },
        BorderStyle::Rounded => BorderGlyphs {
            top_left: '╭',
            top_right: '╮',
            bottom_left: '╰',
            bottom_right: '╯',
            horizontal: '─',
            vertical: '│',
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_style_has_distinct_corners() {
        assert_eq!(glyphs(BorderStyle::Single).top_left, '┌');
        assert_eq!(glyphs(BorderStyle::Double).top_left, '╔');
        assert_eq!(glyphs(BorderStyle::Rounded).top_left, '╭');
        // rounded reuses the straight runs of single
        assert_eq!(
            glyphs(BorderStyle::Rounded).horizontal,
            glyphs(BorderStyle::Single).horizontal
        );
    }
}
