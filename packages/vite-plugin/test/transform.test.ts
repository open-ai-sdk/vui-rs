// Compiler-level tests for the vui SFC plugin. These compile template/SFC source
// with the exact `vuiCompilerOptions()` the plugin feeds `@vitejs/plugin-vue`,
// and assert the emitted render fn targets the custom renderer: vui tags are
// elements (no component resolution), `<input>` resolves to a component (so
// v-model reaches `VuiInput`), `v-model` emits the `value`/`onUpdate:value`
// contract, and `<style>` blocks are stripped.
import { describe, expect, test } from 'bun:test'
import { type SFCTemplateCompileResults, compileTemplate, parse } from '@vue/compiler-sfc'
import { vuiCompilerOptions, vuiVitePlugin } from '../src/index.ts'

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

describe('vuiCompilerOptions — tag resolution', () => {
  test('vui element tags compile as elements, not resolved components', () => {
    const code = compile(`<box flexDirection="column"><text :fg="c">hi</text></box>`)
    expect(code).toContain(`createElementBlock("box"`)
    expect(code).toContain(`createElementVNode("text"`)
    expect(code).not.toContain(`resolveComponent("box")`)
    expect(code).not.toContain(`resolveComponent("text")`)
  })

  test('inline run-style tags (b/i/u/em/strong) are elements', () => {
    const code = compile(`<text><b>x</b><i>y</i><u>z</u><em>p</em><strong>q</strong></text>`)
    for (const tag of ['b', 'i', 'u', 'em', 'strong']) {
      expect(code).toContain(`createElementVNode("${tag}"`)
      expect(code).not.toContain(`resolveComponent("${tag}")`)
    }
  })

  test('<input> resolves to a component (so it reaches VuiInput)', () => {
    const code = compile(`<input placeholder="x" />`)
    expect(code).toContain(`resolveComponent("input")`)
    expect(code).not.toContain(`createElementVNode("input"`)
  })

  test('<textarea> resolves to a component (so it reaches VuiTextarea)', () => {
    const code = compile(`<textarea placeholder="x" />`)
    expect(code).toContain(`resolveComponent("textarea")`)
    expect(code).not.toContain(`createElementVNode("textarea"`)
  })

  test('extra customElements are treated as elements', () => {
    const res = compileTemplate({
      source: `<x-panel></x-panel>`,
      filename: 'T.vue',
      id: 't',
      compilerOptions: vuiCompilerOptions({ customElements: ['x-panel'] }),
    })
    expect(res.code).toContain(`createElementBlock("x-panel"`)
  })

  test('camelCase prop names survive verbatim (match the h() API keys)', () => {
    const code = compile(`<box flexDirection="column" :borderColor="c" titleAlign="center"></box>`)
    expect(code).toContain('flexDirection')
    expect(code).toContain('borderColor')
    expect(code).toContain('titleAlign')
  })
})

describe('vuiModelTransform — v-model contract', () => {
  test('v-model on <input> emits value + onUpdate:value (not modelValue)', () => {
    const code = compile(`<input v-model="name" />`)
    expect(code).toContain('value:')
    expect(code).toContain(`"onUpdate:value"`)
    expect(code).not.toContain('modelValue')
  })

  test('v-model on <textarea> emits value + onUpdate:value', () => {
    const code = compile(`<textarea v-model="body" />`)
    expect(code).toContain('value:')
    expect(code).toContain(`"onUpdate:value"`)
    expect(code).not.toContain('modelValue')
  })

  test('v-model on <select-list> keeps modelValue + onUpdate:modelValue', () => {
    const code = compile(`<select-list v-model="choice" :items="items" />`)
    expect(code).toContain('modelValue:')
    expect(code).toContain(`"onUpdate:modelValue"`)
    expect(code).not.toContain(`"onUpdate:value"`)
  })

  test('v-model on <scroll-box> keeps modelValue + onUpdate:modelValue', () => {
    const code = compile(`<scroll-box v-model="scrollY"></scroll-box>`)
    expect(code).toContain('modelValue:')
    expect(code).toContain(`"onUpdate:modelValue"`)
    expect(code).not.toContain(`"onUpdate:value"`)
  })

  test('v-model argument on <scroll-bar> keeps the requested prop', () => {
    const code = compile(`<scroll-bar v-model:scrollY="scrollY" :viewportHeight="3" :contentHeight="8" />`)
    expect(code).toContain('scrollY:')
    expect(code).toContain(`"onUpdate:scrollY"`)
    expect(code).not.toContain('modelValue')
  })

  test('v-model on a non-editable element is a compile error', () => {
    const res = compileTemplate({
      source: `<box v-model="x"></box>`,
      filename: 'T.vue',
      id: 't',
      compilerOptions: vuiCompilerOptions(),
    })
    expect(res.errors.length).toBeGreaterThan(0)
    expect(String(res.errors[0])).toContain('v-model')
  })
})

describe('vuiVitePlugin — <style> handling', () => {
  test('a pre-transform strips <style> blocks before plugin-vue parses', () => {
    const plugins = vuiVitePlugin()
    const strip = plugins.find((p) => p.name === 'vui:strip-sfc-style')!
    const transform = strip.transform as (code: string, id: string) => { code: string } | null
    const sfc = `<template><box></box></template>\n<style>.x { color: red }</style>`
    const out = transform(sfc, 'App.vue')
    expect(out).not.toBeNull()
    expect(out!.code).not.toContain('<style>')
    expect(out!.code).toContain('<template>')
  })

  test('non-.vue ids and style-free SFCs are passed through untouched', () => {
    const plugins = vuiVitePlugin()
    const strip = plugins.find((p) => p.name === 'vui:strip-sfc-style')!
    const transform = strip.transform as (code: string, id: string) => unknown
    expect(transform(`<style>.x{}</style>`, 'main.ts')).toBeNull()
    expect(transform(`<template><box/></template>`, 'App.vue')).toBeNull()
  })
})
