---
"@vui-rs/vue": minor
---

Add a `titleClick` event for bordered elements. A mouse-down that lands on a node's painted `title` cells (the top border row, honoring `titleAlign`) dispatches a bubbling `titleClick` instead of a body `mousedown`, and does not move focus — making a border title an interactive affordance (e.g. click a composer's model-name title to open a picker). New `onTitleClick` prop on box/text/input/textarea; no effect unless a handler and a `title` are set. Exposes `titleHitRect()` from the paint helpers (shared by `drawTitle` and the hit-test so paint and click agree on the title's cells).
