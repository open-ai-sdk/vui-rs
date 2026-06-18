---
"@vui-rs/vue": patch
---

Allow drag-to-select-and-copy over an editable (`<input>`/textarea), e.g. a chat composer. A press on an editable now anchors a host selection without consuming the event, so a plain click still focuses and places the cursor while a drag selects its visible text and copies on release (honoring `copyOnSelect`/Ctrl+C, same as static text). Previously selection only worked over static `<text>`/`<markdown>`, so composer content could not be selected at all.
