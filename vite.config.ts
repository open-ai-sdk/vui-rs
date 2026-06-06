// Root config for the `vite-plus` (vp) toolchain — NOT a bundler config for the
// app (each example owns its own vite.config.ts). It drives `vp run` (cached task
// runner), `vp lint` (oxlint), `vp fmt` (oxfmt), and the staged pre-commit check.
// `vp config` (the `prepare` script) reads this to install the git hook + editor
// config. Formatting is set to vui-rs's existing house style (double quotes,
// semicolons) so `vp fmt` is a no-op on the current tree, not a mass reformat.
import { defineConfig } from 'vite-plus'

export default defineConfig({
  // `vp run <task>` — content-hash caching so unchanged packages skip rebuilds.
  run: {
    cache: {
      scripts: true,
      tasks: true,
    },
    tasks: {
      // `clean` has no package.json script of the same name, so it's a pure vp
      // task. (Don't define tasks named like existing scripts — e.g. `test` /
      // `build:native` — vp treats that as a conflict; those run via `bun run`.)
      clean: {
        command: 'rm -rf packages/*/dist packages/core/native target/release .tsbuildinfo',
        cache: false,
      },
    },
  },

  // Pre-commit (installed by `vp config`): lint + format staged files, auto-fixing.
  staged: {
    '*': 'vp check --fix',
  },

  // oxlint — keep it fast: no type-aware rules (those need tsgolint + a slow type
  // pass). `tsc`/`vue-tsc` already cover type-checking in CI.
  lint: {
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },

  // oxfmt — single quotes, no semicolons, 120 cols (shared house style with the
  // sibling repos). Skip generated output, prose, and the vendored theme JSON.
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 120,
    ignorePatterns: [
      '**/dist/**',
      '**/native/**',
      'target/**',
      // Prose + generated/vendored files the code formatter shouldn't touch.
      '**/*.md',
      'plans/**',
      'reports/**',
      '.changeset/**',
      'packages/vue/src/theme/builtin/*.json',
    ],
  },
})
