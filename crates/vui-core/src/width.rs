//! Terminal column width. Centralizing on `unicode-width` keeps the cell grid's
//! idea of how many columns a glyph occupies in step with what well-behaved
//! terminals actually advance the cursor by. Wide CJK/emoji => 2 columns.

use unicode_width::UnicodeWidthChar;

/// Column width of a single codepoint: 0 (combining/control), 1, or 2.
///
/// v0 stores one leading codepoint per grapheme cluster, so width is measured
/// on that codepoint. Multi-codepoint graphemes (ZWJ emoji, decomposed accents)
/// are a documented v0 limitation — a grapheme pool is a later refinement.
pub fn char_width(ch: char) -> usize {
    UnicodeWidthChar::width(ch).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_is_one() {
        assert_eq!(char_width('A'), 1);
    }

    #[test]
    fn wide_cjk_is_two() {
        assert_eq!(char_width('世'), 2);
    }

    #[test]
    fn control_is_zero() {
        assert_eq!(char_width('\u{0}'), 0);
    }
}
