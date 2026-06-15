import { describe, expect, test } from 'bun:test'
import { h } from '@vui-rs/vue'
import { VuiTable, type TableColumn, computeColumnWidths, displayWidth, padCell } from '../src/table.ts'
import { mount, rowGlyphs } from './helpers.ts'

describe('displayWidth', () => {
  test('counts ASCII one cell per char', () => {
    expect(displayWidth('abc')).toBe(3)
  })
  test('counts wide CJK glyphs as two cells (not .length)', () => {
    expect(displayWidth('你好')).toBe(4)
    expect('你好'.length).toBe(2) // the bug VuiTable avoids
  })
})

describe('computeColumnWidths', () => {
  const cols: TableColumn[] = [
    { key: 'a', header: 'AA' },
    { key: 'b', header: 'B', width: 4 },
  ]
  test('auto column sizes to the widest of header and cells', () => {
    const rows = [
      { a: 'xxxxx', b: 'y' },
      { a: 'z', b: 'y' },
    ]
    expect(computeColumnWidths(cols, rows)[0]).toBe(5) // 'xxxxx'
  })
  test('auto column falls back to header width when cells are narrower', () => {
    expect(computeColumnWidths(cols, [{ a: 'x', b: 'y' }])[0]).toBe(2) // 'AA'
  })
  test('fixed width is honored regardless of content', () => {
    expect(computeColumnWidths(cols, [{ a: 'x', b: 'yyyyyyyy' }])[1]).toBe(4)
  })
  test('CJK content sizes by display width', () => {
    expect(computeColumnWidths([{ key: 'a', header: 'h' }], [{ a: '你好' }])[0]).toBe(4)
  })
})

describe('padCell', () => {
  test('left-align pads on the right', () => {
    expect(padCell('hi', 5, 'left')).toBe('hi   ')
  })
  test('right-align pads on the left', () => {
    expect(padCell('hi', 5, 'right')).toBe('   hi')
  })
  test('overflow truncates and appends … to exactly the column width', () => {
    const out = padCell('hello world', 6, 'left')
    expect(displayWidth(out)).toBe(6)
    expect(out).toBe('hello…')
  })
  test('exact-fit string is returned unchanged', () => {
    expect(padCell('exact', 5, 'left')).toBe('exact')
  })
})

const COLUMNS: TableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age', align: 'right' },
]
const ROWS = [
  { name: 'Alice', age: '30' },
  { name: 'Bob', age: '7' },
]

describe('VuiTable render', () => {
  test('renders header, ─┼─ separator, and body rows', async () => {
    const { renderer, settle, cleanup } = mount(30, 8, () => h(VuiTable, { columns: COLUMNS, rows: ROWS }))
    await settle()
    expect(rowGlyphs(renderer, 0)).toContain('Name')
    expect(rowGlyphs(renderer, 0)).toContain('Age')
    expect(rowGlyphs(renderer, 1)).toContain('┼') // separator row
    expect(rowGlyphs(renderer, 2)).toContain('Alice')
    expect(rowGlyphs(renderer, 2)).toContain('30')
    cleanup()
  })

  test('right-aligned column pads the cell on the left', async () => {
    const { renderer, settle, cleanup } = mount(30, 8, () => h(VuiTable, { columns: COLUMNS, rows: ROWS }))
    await settle()
    // 'Age' column width = 3; Bob's age '7' right-aligned → "  7".
    const bobRow = rowGlyphs(renderer, 3)
    expect(bobRow).toContain('  7')
    cleanup()
  })

  test('empty rows renders a muted (no rows) line', async () => {
    const { renderer, settle, cleanup } = mount(30, 8, () => h(VuiTable, { columns: COLUMNS, rows: [] }))
    await settle()
    let found = false
    for (let y = 0; y < 8; y++) if (rowGlyphs(renderer, y).includes('(no rows)')) found = true
    expect(found).toBe(true)
    cleanup()
  })

  test('bordered variant wraps the table in a rounded box', async () => {
    const { renderer, settle, cleanup } = mount(30, 8, () =>
      h(VuiTable, { columns: COLUMNS, rows: ROWS, bordered: true }),
    )
    await settle()
    expect(rowGlyphs(renderer, 0)).toContain('╭') // rounded top-left corner
    cleanup()
  })
})
