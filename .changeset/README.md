# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets) — it records intended version bumps for the published `@vui-rs/*` packages.

## Adding a changeset

When you make a change worth releasing, run:

```sh
bun run changeset
```

Pick the affected packages and the bump type (`patch` / `minor` / `major`), write a one-line summary, and commit the generated `.changeset/*.md` file with your PR.

## How releases happen

On merge to `main`, the release workflow:

1. If there are pending changesets → opens/updates a **"Version Packages"** PR (`changeset version`: bumps versions + writes CHANGELOGs).
2. When that PR is merged → builds the native binaries (cross-compiled with `cargo-zigbuild`) and publishes each package with **`bun publish`** (which resolves `workspace:`/`catalog:` protocols), then tags the release.

Private packages (the `examples/*`) are excluded.
