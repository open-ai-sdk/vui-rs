---
"@vui-rs/core": minor
"@vui-rs/vue": minor
---

Add per-token highlight to the native `<textarea>` editor. `EditorView.setHighlights(ranges, color)` paints the given grapheme-offset ranges in an accent fg (new FFI `vui_editor_set_highlights`, ABI 14). The `<textarea>` gains `highlightSigil` + `highlightColor` props: whitespace-delimited tokens starting with the sigil (e.g. `$skill`) render in the accent color, computed in the host with the editor's grapheme-offset model. No effect when the props are unset.
