---
"@vui-rs/core": patch
---

Cache `<text>` measurement so an unchanged text node is not re-wrapped on every layout pass.

Dirtying any single node (e.g. an animating indicator) invalidates its ancestor chain up to the root, which made taffy re-run the measure callback over **every** text leaf in the tree — each call re-wrapping its content and doing an O(N) linear slab scan to resolve the node. On a large tree with a frequently-redrawn node this dominated the frame (tens of ms per layout, scaling with total on-screen text).

`measure_node` now memoizes each node's wrapped size keyed by a per-node version (bumped only when its runs or wrap mode change) and the wrap budget, and resolves the node through an O(1) `TaffyId → node` index built once per layout instead of the per-call scan. Output is pixel-identical; per-frame layout cost drops from O(total text) to O(changed). Cache entries are dropped when a node is freed.
