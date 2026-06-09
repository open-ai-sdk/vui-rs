---
"@vui-rs/vue": patch
---

`<input>` gains a `ctrlCBehavior` prop (`'exit'` default | `'capture'`).

With `'capture'`, the host dispatches Ctrl+C to the focused input first (so a `keyDown` handler can e.g. clear the text) and only quits the app if the event is left unhandled — i.e. an empty input still exits on Ctrl+C, but a non-empty one can intercept it. Mirrors the existing `tabBehavior` opt-in and the textarea copy-on-selection carve-out.
