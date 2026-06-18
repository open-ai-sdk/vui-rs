---
"@vui-rs/core": patch
---

Fix wrapped `<text>` overflowing when it is a `flex-grow` child of a flex ROW (e.g. a markdown list item: bullet + content). A text node reported its max-content width as its min-content width too, so its automatic `min-width: auto` pinned the column at the full single-line width and it could never shrink to wrap — the text bled past the parent's right edge (visible as text overpainting a bordered box). The taffy measure callback now answers the min-content probe with the node's true narrowest width.
