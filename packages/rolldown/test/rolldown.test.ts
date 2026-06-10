// Tests for `@vui-rs/rolldown` — the SFC build path for rolldown/tsdown plugin
// authors. Two layers, both required:
//
//  1. Compiler-options + plugin shape (fast): assert `vuiRolldown()` returns the
//     `[style-strip, unplugin-vue]` pair in pre-then-compile order, the strip
//     only touches `<style>` in `.vue` files, and the reused `vuiCompilerOptions`
//     still compile vui tags as elements with the `value`/`onUpdate:value`
//     v-model contract and `@vue/runtime-core` helper imports.
//
//  2. End-to-end tsdown build (the real guard): run a programmatic `build()` on a
//     styled SFC whose `<script setup>` uses `defineModel` + `withDefaults` (the
//     macros `@vue/compiler-sfc` hardcodes from the bare `'vue'` specifier). With
//     `alias: { vue: '@vue/runtime-core' }` + `deps.neverBundle: ['vue', /^@vue\//]`,
//     the emitted bundle must (a) carry NO `?vue&type=style` / CSS artifact,
//     (b) carry NO bare `from "vue"`, and (c) keep `@vue/runtime-core` external.
//     This pins the two contracts the renderer silently breaks if they regress:
//     style-strip ordering and macro-import rewriting.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type SFCTemplateCompileResults, compileTemplate } from '@vue/compiler-sfc'
import { vuiCompilerOptions } from '@vui-rs/vite-plugin'
import { build } from 'tsdown'
import { vuiRolldown } from '../src/index.ts'

// ---------------------------------------------------------------------------
// Layer 1 — plugin shape + reused compiler options
// ---------------------------------------------------------------------------

interface PreTransformHook {
  order: 'pre'
  handler: (code: string, id: string) => { code: string } | null
}

describe('vuiRolldown — plugin shape', () => {
  test('returns [style-strip, unplugin-vue] so the strip runs before compilation', () => {
    const plugins = vuiRolldown()
    expect(plugins.map((p) => p.name)).toEqual(['vui:strip-sfc-style', 'unplugin-vue'])
  })

  test('style-strip is a pre transform that removes <style> from .vue files only', () => {
    const [strip] = vuiRolldown()
    const transform = strip.transform as unknown as PreTransformHook
    expect(transform.order).toBe('pre')

    const sfc = `<template><box></box></template>\n<style>.x { color: red }</style>`
    const out = transform.handler(sfc, 'App.vue')
    expect(out).not.toBeNull()
    expect(out!.code).not.toContain('<style>')
    expect(out!.code).toContain('<template>')

    // non-.vue ids and style-free SFCs pass through untouched
    expect(transform.handler(`<style>.x{}</style>`, 'main.ts')).toBeNull()
    expect(transform.handler(`<template><box/></template>`, 'App.vue')).toBeNull()
  })
})

describe('vuiRolldown — reused compiler options target the custom renderer', () => {
  function compile(source: string): string {
    const res: SFCTemplateCompileResults = compileTemplate({
      source,
      filename: 'Test.vue',
      id: 'test',
      compilerOptions: vuiCompilerOptions(),
    })
    expect(res.errors).toEqual([])
    return res.code
  }

  test('vui tags are elements, <input v-model> emits value/onUpdate:value, helpers from @vue/runtime-core', () => {
    const code = compile(`<box flexDirection="column"><text>hi</text><input v-model="x" /></box>`)
    expect(code).toContain(`createElementBlock("box"`)
    expect(code).toContain(`createElementVNode("text"`)
    expect(code).toContain(`resolveComponent("input")`)
    expect(code).toContain('value:')
    expect(code).toContain(`"onUpdate:value"`)
    expect(code).not.toContain('modelValue')
    expect(code).toContain(`from "@vue/runtime-core"`)
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — end-to-end tsdown build (the real regression guard)
// ---------------------------------------------------------------------------

describe('vuiRolldown — end-to-end tsdown build', () => {
  const work = mkdtempSync(join(tmpdir(), 'vui-rolldown-test-'))
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  test('a styled, macro-using SFC builds with no CSS artifact, no bare vue, vue external', async () => {
    // <style> exercises the strip; defineModel/withDefaults exercise the macro
    // helpers (`useModel`/`mergeModels`) that compile-sfc hardcodes from 'vue'.
    const sfc = `<template>
  <box><input v-model="name" /></box>
</template>
<script setup lang="ts">
const name = defineModel<string>('name')
withDefaults(defineProps<{ title?: string }>(), { title: 'x' })
</script>
<style>.x { color: red }</style>
`
    writeFileSync(join(work, 'Widget.vue'), sfc)
    writeFileSync(join(work, 'tui.ts'), `import Widget from './Widget.vue'\nexport default Widget\n`)
    const outDir = join(work, 'out')

    await build({
      entry: [join(work, 'tui.ts')],
      outDir,
      format: 'esm',
      platform: 'neutral',
      dts: false,
      config: false,
      plugins: vuiRolldown(),
      alias: { vue: '@vue/runtime-core' },
      deps: { neverBundle: ['vue', /^@vue\//] },
      silent: true,
    })

    const jsFile = readdirSync(outDir).find((f) => f.endsWith('.js'))
    expect(jsFile).toBeDefined()
    const bundle = readFileSync(join(outDir, jsFile!), 'utf8')

    // (a) style block stripped — no virtual CSS import reaches the bundle
    expect(bundle).not.toContain('?vue&type=style')
    expect(bundle).not.toContain('.css')
    // (b) no bare `vue` specifier survives (the macro-alias rewrote it)
    expect(bundle).not.toMatch(/from\s*["']vue["']/)
    // (c) the host runtime stays external, routed to @vue/runtime-core
    expect(bundle).toMatch(/from\s*["']@vue\/runtime-core["']/)
    // sanity: the macro helpers actually landed (proves the SFC compiled, not skipped)
    expect(bundle).toContain('useModel')
    expect(bundle).toContain('mergeModels')
  }, 30_000)
})
