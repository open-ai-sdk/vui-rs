---
"@vui-rs/vue": minor
---

Add anchor-tracking + click-focus opt-out primitives for popups (additive, no breaking changes):

- **`useElementRect(elRef)`** — reactively read an element's absolute screen rect (`{ x, y, width, height }` in terminal cells), refreshed whenever layout recomputes (resize, content reflow, a dock/sibling appearing). Lets a popup anchor itself to another element (e.g. an input) with no polling. Not driven by paint-only scroll offsets, so anchor an element that is a sibling of any scroll viewport, not a descendant of one. Backed by a new `getScreenRect` walk and a layout-tick subscription on the host context.
- **`clickFocus` prop** (default `true`) — a focusable container with `clickFocus: false` still accepts `:focused`/programmatic focus and key dispatch, but is skipped by click-to-focus and Tab traversal. An app shell can hold focus for global keys while busy without a click on the rest of the UI stealing focus from the input.
