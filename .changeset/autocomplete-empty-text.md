---
"@vui-rs/ui": patch
---

`VuiAutocomplete` can show a "no results" placeholder (additive, backward compatible):

- New **`emptyText`** prop: when there are no suggestions, the popup renders a single non-interactive muted row with this text (e.g. "No matching items") instead of disappearing. Works in both overlay (`anchor`) and in-flow modes; the empty row reserves one line in the height/clamp math and emits no `select`.
- Omitting `emptyText` keeps the original behavior — an empty suggestion list renders nothing — so existing consumers are unchanged.

This lets a consumer that mounts the popup while a trigger is active (e.g. a `/` command menu) keep it open and show a "no match" hint, matching opencode's autocomplete.
