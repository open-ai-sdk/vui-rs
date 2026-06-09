---
"@vui-rs/vue": patch
---

`<input>` gains readline-style line editing (parity with opencode's prompt):

- **Ctrl+U** → delete to line start
- **Ctrl+W**, **Ctrl+Backspace**, **Alt+Backspace** → delete the previous word
- **Ctrl+K** → delete to line end

Backed by new `EditRenderable` ops `deleteToStart()`, `deleteWordLeft()`, `deleteToEnd()`. Plain `u`/`w`/`k` still type normally — the actions require the Ctrl modifier.
