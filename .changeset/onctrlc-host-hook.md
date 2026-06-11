---
"@vui-rs/vue": minor
---

Add an opt-in `onCtrlC` host hook (additive, no breaking changes):

- **`HostMountOptions.onCtrlC?: () => void`** — take over the decision for an otherwise-unhandled Ctrl+C instead of the host's default `unmount()` + `process.exit(0)`. It only fires for presses that would have exited; the higher-priority paths still win first and never reach it: active-selection copy (OSC 52), a focused textarea with a selection, and a focused input with `ctrlCBehavior: 'capture'` that consumes the press (`preventDefault`). When set, the app owns exiting itself — letting a TUI show an exit-confirm prompt before quitting. With the option absent, behavior is byte-identical to before.
