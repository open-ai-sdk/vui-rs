// End-to-end SFC test: compile a `.vue` template the same way the Vite plugin
// does, then mount the compiled render fn through the real custom renderer
// offscreen and assert it both paints and round-trips v-model. This proves the
// whole path — `compileTemplate` (custom compiler options) → render fn →
// `createApp` → FFI cell buffer — without standing up a full Vite build.
import { afterAll, describe, expect, test } from 'bun:test'
import { unlinkSync } from 'node:fs'
import { compileTemplate } from '@vue/compiler-sfc'
import { Renderer, parseKeys } from '@vui-rs/core'
import { vuiCompilerOptions } from '../../vite-plugin/src/index.ts'
import { createApp, defineComponent, nextTick, ref } from '../src/index.ts'
import { allGlyphs } from './helpers/read-buffer.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// `compileTemplate` emits an ESM render fn (`export function render(_ctx, _cache)`)
// with helper imports from `@vue/runtime-core`. Bun can only `import()` a real
// file, so write the code to a temp module next to this test (where bare
// specifiers resolve), import it, and clean up afterwards.
const tmpFiles: string[] = []
async function compileRender(source: string, tag: string): Promise<(...a: unknown[]) => unknown> {
  const { code, errors } = compileTemplate({
    source,
    filename: `${tag}.vue`,
    id: tag,
    compilerOptions: vuiCompilerOptions(),
  })
  expect(errors).toEqual([])
  const path = `${import.meta.dir}/.tmp-sfc-${tag}.mjs`
  await Bun.write(path, code)
  tmpFiles.push(path)
  const mod = (await import(path)) as { render: (...a: unknown[]) => unknown }
  return mod.render
}

afterAll(() => {
  for (const f of tmpFiles) {
    try {
      unlinkSync(f)
    } catch {}
  }
})

describe('compiled SFC mounts through the renderer', () => {
  test('renders interpolation + inline tags to the cell buffer', async () => {
    const render = await compileRender(
      `<box flexDirection="column" :width="12" :height="3">
        <text :width="{ pct: 1 }" :height="1" :fg="G">hi <b :fg="G">{{ name }}</b></text>
      </box>`,
      'paint',
    )
    const r = new Renderer(20, 4)
    const App = defineComponent({
      setup: () => ({ name: ref('bob'), G: '#a6e3a1' }),
      render,
    })
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    try {
      await nextTick()
      app.context.flushNow()
      expect(allGlyphs(r)).toContain('hibob')
    } finally {
      app.unmount()
      r.free()
    }
  })

  test('v-for renders a list of elements inside a box (fragment anchors)', async () => {
    // v-for wraps its output in a Vue fragment, which brackets the items with
    // empty text-node anchors inserted into the <box>. This must not trip the
    // "bare strings must be wrapped in <text>" guard.
    const render = await compileRender(
      `<box flexDirection="column" :width="10" :height="4">
        <text v-for="(item, i) in items" :key="i" :width="{ pct: 1 }" :height="1" :fg="C">{{ item }}</text>
      </box>`,
      'vfor',
    )
    const r = new Renderer(12, 5)
    const App = defineComponent({
      setup: () => ({ items: ref(['aa', 'bb', 'cc']), C: '#cdd6f4' }),
      render,
    })
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    try {
      await nextTick()
      app.context.flushNow()
      const screen = allGlyphs(r)
      expect(screen).toContain('aa')
      expect(screen).toContain('bb')
      expect(screen).toContain('cc')
    } finally {
      app.unmount()
      r.free()
    }
  })

  test('v-model on <input> round-trips through VuiInput', async () => {
    const render = await compileRender(
      `<box flexDirection="column">
        <input :width="{ pct: 1 }" :height="1" :focused="true" v-model="name" />
      </box>`,
      'vmodel',
    )
    const r = new Renderer(20, 3)
    const name = ref('')
    const App = defineComponent({
      setup: () => ({ name }),
      render,
    })
    const app = createApp(App).mount({ renderer: r, altScreen: false })
    try {
      await nextTick()
      await sleep(10) // el-watch applies focus
      for (const ev of parseKeys('yo')) app.context.focusManager!.dispatch(ev)
      expect(name.value).toBe('yo')
    } finally {
      app.unmount()
      r.free()
    }
  })
})
