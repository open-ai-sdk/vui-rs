---
"@vui-rs/vue": patch
---

Fix `<input>` block cursor blanking the placeholder's first character. With an
empty value, the focused cursor now reveals the placeholder glyph underneath it
(e.g. the "A" of "Ask…") instead of painting a space over it — previously the
first placeholder char appeared to vanish, and flickered once the cursor blinked.
