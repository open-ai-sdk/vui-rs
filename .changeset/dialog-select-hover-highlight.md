---
"@vui-rs/ui": patch
---

Fix `VuiDialogSelect`: hovering a row now moves the active highlight to it (parity with Up/Down). Rows previously reacted only to click (`onMouseDown`); a new `onMouseMove` handler updates the active index on hover.
