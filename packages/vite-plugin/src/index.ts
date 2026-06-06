// `@vui-rs/vite-plugin` — the single config an SFC author needs to compile `.vue`
// files for vui-rs. It wraps the official `@vitejs/plugin-vue` with the two
// custom-renderer adjustments: (1) `isCustomElement` so vui tags compile to
// `createElementVNode` instead of failed component lookups, and (2) a `v-model`
// transform emitting vui's `value`/`onUpdate:value` contract. A pre-transform
// strips `<style>` blocks and asset-url rewrites are off — a TUI has neither CSS
// nor asset URLs.
//
// Build-time only: this runs in the Vite/Rollup process, never at app runtime,
// so it adds no FFI surface. Run Vite under Bun (the toolchain `bun:ffi` import
// in the catalogue dependency resolves there).
import vue, { type Options as VuePluginOptions } from '@vitejs/plugin-vue'
import type { CompilerOptions } from '@vue/compiler-core'
import type { Plugin } from 'vite'
import { vuiModelTransform } from './vui-model-transform.ts'

export { vuiModelTransform } from './vui-model-transform.ts'

/**
 * Built-in tags the template compiler treats as vui *elements* (not components).
 * Mirrors the element entries of `packages/vue/src/catalogue.ts` — kept as a
 * standalone literal on purpose: the build tool runs under Node where the
 * bun-native runtime (`@vui-rs/core`'s `bun:ffi`) can't load, so it must NOT
 * import the catalogue. `input` is deliberately ABSENT: it resolves to the
 * `VuiInput` component (registered at app create) so v-model round-trips through
 * its editing logic. Keep this in sync with the catalogue's element tags.
 */
const VUI_ELEMENT_TAGS = new Set(['box', 'text', 'span', 'b', 'strong', 'i', 'em', 'u', 'canvas', 'overlay', 'image'])

export interface VuiVitePluginOptions {
  /**
   * Extra element tags to treat as vui elements (not Vue components). Needed for
   * tags registered at *runtime* via `extend()`: the build runs in a separate
   * process where those calls haven't happened, so list them here.
   */
  customElements?: string[]
}

/**
 * The compiler options that target the vui custom renderer. Exported on its own
 * so tooling (and tests) can compile a `.vue` with the exact same settings the
 * plugin uses, without standing up a full Vite build.
 *
 * `runtimeModuleName` points compiler-injected helpers (`createElementVNode`,
 * `toDisplayString`, …) at `@vue/runtime-core` — vui-rs depends on that package
 * directly and has no `vue` meta-package, so the default `"vue"` would not
 * resolve at runtime.
 */
export function vuiCompilerOptions(options: VuiVitePluginOptions = {}): CompilerOptions {
  const extra = new Set(options.customElements ?? [])
  return {
    runtimeModuleName: '@vue/runtime-core',
    // A TUI has no native HTML tags. Without this, the DOM compiler's built-in
    // `isNativeTag` knows `input`/`b`/`u`/… as HTML and would compile them as
    // native elements. We declare the real vui elements via `isCustomElement`;
    // everything else (e.g. `<input>`) then resolves as a component — which is
    // how `<input>` reaches `VuiInput` and its editing logic.
    isNativeTag: () => false,
    isCustomElement: (tag: string) => VUI_ELEMENT_TAGS.has(tag) || extra.has(tag),
    directiveTransforms: { model: vuiModelTransform },
  }
}

/**
 * Strip `<style>` blocks before `@vitejs/plugin-vue` parses the SFC, so a TUI app
 * never pulls a CSS pipeline it has no use for. Runs `pre` so the main `.vue`
 * transform sees source with no style block at all.
 */
function stripSfcStylePlugin(): Plugin {
  return {
    name: 'vui:strip-sfc-style',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue') || !/<style[\s>]/i.test(code)) return null
      return { code: code.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''), map: null }
    },
  }
}

/** The vui-rs SFC plugin: `@vitejs/plugin-vue` configured for the custom renderer. */
export function vuiVitePlugin(options: VuiVitePluginOptions = {}): Plugin[] {
  const pluginOptions: VuePluginOptions = {
    template: {
      compilerOptions: vuiCompilerOptions(options),
      transformAssetUrls: false, // a TUI has no asset URLs (<img src>, …)
    },
  }
  return [stripSfcStylePlugin(), vue(pluginOptions)]
}
