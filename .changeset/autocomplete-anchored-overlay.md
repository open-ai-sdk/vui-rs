---
"@vui-rs/ui": minor
---

`VuiAutocomplete` can render as an anchored overlay popup (additive, backward compatible):

- New **`anchor`** prop (a screen rect, e.g. from `useElementRect`): the suggestion list renders as a z-indexed `<overlay>` that opens **upward** above the anchor — no layout shift in the main tree, clamped to the space above the anchor so it never overflows the top of the screen, and the popup carries no focus trap so the input keeps focus.
- **Windowed scrolling**: the visible suggestions now scroll a window that keeps the active row in view, so rows beyond `maxRows` are reachable (the old `slice(0, maxRows)` made them unreachable).
- Omitting `anchor` keeps the original in-flow rendering under the input, so existing consumers are unchanged.
