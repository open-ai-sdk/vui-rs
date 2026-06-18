---
'@vui-rs/vue': patch
---

Markdown tables: draw the frame, header/row rules and cell separators with the
`borderActive` tone instead of `borderSubtle`. `borderSubtle` is darker than the
background in some themes (e.g. monokai-pro, dracula), which made every separator
invisible and the table read as a broken, columnless block. `borderActive` is the
most prominent border token and stays clearly visible above the background in
every built-in theme.
