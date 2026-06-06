---
"@vui-rs/core": patch
"@vui-rs/vue": patch
"@vui-rs/ui": patch
"@vui-rs/vite-plugin": patch
---

Fix stale internal dependency versions in published packages.

`bun publish` resolves a `workspace:*` dependency to the version recorded in
`bun.lock`, not the bumped `package.json` version. `ci:version` ran
`bun install --lockfile-only`, which does not re-resolve workspace references, so
the lockfile kept the previous version — `@vui-rs/vue@0.1.1` and `@vui-rs/ui@0.1.1`
published with `@vui-rs/core` pinned to `0.1.0` (the unimportable build), making
them fail to install. `ci:version` now runs `bun update` so the lockfile resolves
internal deps to the current versions before publish.
