---
"@vui-rs/ui": minor
---

`VuiDialogSelect` now emits a `highlight` event `(value, item)` whenever the focused row changes — via arrow keys, PageUp/PageDown, mouse hover, or filter typing. Fires once on open (and re-open) for the initial row, and dedupes repeat emits for an unchanged focused option. Purely additive; `select`/`close`/`update:open` are unchanged. Enables live-preview pickers (e.g. apply a theme as the user browses the list before committing).
