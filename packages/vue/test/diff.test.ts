import { describe, expect, test } from 'bun:test'
import { Renderer } from '@vui-rs/core'
import { createHostApp } from '../src/host/create-host-app.ts'
import { parseUnifiedDiff } from '../src/host/diff-parser.ts'
import { VuiDiff } from '../src/host/components/diff.ts'
import { defineComponent, h, nextTick } from '../src/index.ts'
import { cellFg, rowGlyphs } from './helpers/read-buffer.ts'

function mount(w: number, hgt: number, render: () => unknown) {
  const r = new Renderer(w, hgt)
  const App = defineComponent({ setup: () => render })
  const app = createHostApp(App).mount({ renderer: r })
  return {
    app,
    renderer: r,
    cleanup: () => {
      app.unmount()
      r.free()
    },
  }
}

const PATCH = `diff --git a/x.ts b/x.ts
index 111..222 100644
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,4 @@
 ctx
-old
+new1
+new2
 tail`

describe('diff-parser', () => {
  test('classifies meta/hunk/add/del/context', () => {
    const lines = parseUnifiedDiff(PATCH)
    expect(lines.map((l) => l.kind)).toEqual([
      'meta',
      'meta',
      'meta',
      'meta',
      'hunk',
      'context',
      'del',
      'add',
      'add',
      'context',
    ])
  })

  test('tracks old/new line numbers through the hunk', () => {
    const lines = parseUnifiedDiff(PATCH)
    const body = lines.filter((l) => l.kind !== 'meta' && l.kind !== 'hunk')
    expect(body).toEqual([
      { kind: 'context', text: 'ctx', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'old', oldNo: 2 },
      { kind: 'add', text: 'new1', newNo: 2 },
      { kind: 'add', text: 'new2', newNo: 3 },
      { kind: 'context', text: 'tail', oldNo: 3, newNo: 4 },
    ])
  })

  test('strips marker but keeps line content; handles CRLF', () => {
    const lines = parseUnifiedDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n')
    expect(lines[1]).toMatchObject({ kind: 'del', text: 'a' })
    expect(lines[2]).toMatchObject({ kind: 'add', text: 'b' })
  })

  test('empty patch yields no lines', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  test('in-hunk content beginning with --/++ is not mistaken for a file header', () => {
    // `-- dashes` is a removed line whose text starts with `-- `; `++ plus` an
    // added line whose text starts with `++ `. Both must stay add/del with numbers.
    const lines = parseUnifiedDiff('@@ -1,2 +1,2 @@\n keep\n--- dashes\n+++ plus\n')
    expect(lines).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
      { kind: 'context', text: 'keep', oldNo: 1, newNo: 1 },
      { kind: 'del', text: '-- dashes', oldNo: 2 },
      { kind: 'add', text: '++ plus', newNo: 2 },
    ])
  })

  test('hunk line counts close the hunk so later file headers stay meta', () => {
    const lines = parseUnifiedDiff(
      [
        'diff --git a/x b/x',
        '--- a/x',
        '+++ b/x',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/y b/y',
        '--- a/y',
        '+++ b/y',
        '@@ -1 +1 @@',
        '-c',
        '+d',
      ].join('\n'),
    )
    expect(lines.map((l) => l.kind)).toEqual([
      'meta',
      'meta',
      'meta',
      'hunk',
      'del',
      'add',
      'meta',
      'meta',
      'meta',
      'hunk',
      'del',
      'add',
    ])
    // Second file's numbers reset from its own hunk header.
    expect(lines[10]).toMatchObject({ kind: 'del', text: 'c', oldNo: 1 })
    expect(lines[11]).toMatchObject({ kind: 'add', text: 'd', newNo: 1 })
  })
})

describe('VuiDiff render', () => {
  test('colors added green and removed red', async () => {
    const { renderer, cleanup } = mount(30, 12, () => h(VuiDiff, { patch: PATCH }))
    await nextTick()
    // Find the +new1 and -old rows by content.
    let addRow = -1
    let delRow = -1
    for (let y = 0; y < 12; y++) {
      const row = rowGlyphs(renderer, y)
      if (row.includes('+new1')) addRow = y
      if (row.includes('-old')) delRow = y
    }
    expect(addRow).toBeGreaterThanOrEqual(0)
    expect(delRow).toBeGreaterThanOrEqual(0)
    const add = cellFg(renderer, 0, addRow)
    const del = cellFg(renderer, 0, delRow)
    // Green has dominant green channel; red has dominant red channel.
    expect(add.g).toBeGreaterThan(add.r)
    expect(del.r).toBeGreaterThan(del.g)
    cleanup()
  })

  test('line-number gutter shows old/new numbers', async () => {
    const { renderer, cleanup } = mount(36, 12, () => h(VuiDiff, { patch: PATCH, lineNumbers: true }))
    await nextTick()
    let tailRow = -1
    for (let y = 0; y < 12; y++) {
      if (rowGlyphs(renderer, y).includes('tail')) tailRow = y
    }
    expect(tailRow).toBeGreaterThanOrEqual(0)
    // The context "tail" line is old #3 / new #4.
    expect(rowGlyphs(renderer, tailRow)).toContain('3')
    expect(rowGlyphs(renderer, tailRow)).toContain('4')
    cleanup()
  })
})
