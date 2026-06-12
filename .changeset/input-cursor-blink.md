---
"@vui-rs/vue": minor
---

`<input>` now renders a blinking block cursor while focused (classic ~530ms
xterm rate), instead of a static cell. The caret goes solid the instant you
type or move and resumes blinking when idle. Blink is on by default for every
`<input>`; a new `cursorBlink` prop tunes it — `false` keeps a steady cursor,
a number sets a custom half-period in ms. `<textarea>` is unaffected.
