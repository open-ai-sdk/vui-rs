// `@vui-rs/rolldown` — the SFC build path for rolldown/tsdown plugin authors.
// It mirrors `@vui-rs/vite-plugin` but targets the rolldown plugin surface
// (`unplugin-vue/rolldown`) so a TUI plugin author can drop `vuiRolldown()` into
// a `tsdown` config's `plugins` and compile `.vue` SFCs for the vui-rs custom
// renderer — element tags, the TUI v-model contract, and `<style>` stripping.
//
// DRY: the custom-renderer compiler settings live once in `@vui-rs/vite-plugin`
// (`vuiCompilerOptions`/`vuiModelTransform`, pure `@vue/compiler-core` options).
// This package reuses them via a workspace dependency rather than copying the
// element-tag list, which the source warns must be kept in sync.
//
// Build-time only: this runs in the rolldown/tsdown process, never at app
// runtime, so it adds no FFI surface.
import type { Plugin } from 'rolldown'
import Vue from 'unplugin-vue/rolldown'
import { vuiCompilerOptions, type VuiVitePluginOptions } from '@vui-rs/vite-plugin'

/**
 * Strip `<style>` blocks before the Vue compiler — a TUI has no CSS pipeline.
 *
 * Uses the object-hook `transform: { order: 'pre' }` form on purpose:
 * rolldown/tsdown ignore a top-level `enforce` field on plain-object plugins and
 * sort by per-hook `order`, so this guarantees the strip runs BEFORE unplugin-vue.
 * Otherwise a `<style>` block reaches the compiler and emits an unresolvable
 * `?vue&type=style` virtual import that a `platform:'neutral'` build can't handle.
 */
function stripStyle() {
  return {
    name: 'vui:strip-sfc-style',
    transform: {
      order: 'pre' as const,
      handler(code: string, id: string) {
        if (!id.endsWith('.vue') || !/<style[\s>]/i.test(code)) return null
        return { code: code.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''), map: null }
      },
    },
  }
}

/**
 * vui-rs SFC compilation for rolldown/tsdown. Assign the returned array to a
 * tsdown `plugins`.
 *
 * NOTE: this compiles *templates* for the custom renderer, but it CANNOT rewrite
 * `<script setup>` macro imports — `@vue/compiler-sfc` hardcodes macro helpers
 * (`useModel` for `defineModel`, `mergeDefaults` for `withDefaults`, …) from the
 * bare `'vue'` specifier, which `runtimeModuleName` does not touch. The AUTHOR'S
 * tsdown config must therefore add `alias: { vue: '@vue/runtime-core' }` and keep
 * `'vue'` + `/^@vue\//` in `deps.neverBundle`. See the authoring guide.
 */
export function vuiRolldown(options: VuiVitePluginOptions = {}): Plugin[] {
  return [
    stripStyle(),
    Vue({
      isProduction: true,
      template: { compilerOptions: vuiCompilerOptions(options), transformAssetUrls: false },
    }),
  ]
}
