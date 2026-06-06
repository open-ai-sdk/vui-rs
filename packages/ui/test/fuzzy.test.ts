import { describe, expect, test } from 'bun:test'
import { fuzzyFilter, fuzzyMatch } from '../src/fuzzy.ts'

describe('fuzzyMatch', () => {
  test('returns null when query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'open file')).toBeNull()
  })

  test('matches a subsequence and reports the matched indices', () => {
    const m = fuzzyMatch('of', 'open file')
    expect(m).not.toBeNull()
    expect(m!.indices).toEqual([0, 5]) // 'o' at 0, 'f' at 5
  })

  test('is case-insensitive', () => {
    expect(fuzzyMatch('OF', 'open file')).not.toBeNull()
  })

  test('empty query matches everything with score 0', () => {
    const m = fuzzyMatch('', 'anything')
    expect(m).toEqual({ score: 0, indices: [] })
  })

  test('contiguous start-anchored match outscores a scattered one', () => {
    const start = fuzzyMatch('op', 'open')!
    const scattered = fuzzyMatch('op', 'compose')!
    expect(start.score).toBeGreaterThan(scattered.score)
  })
})

describe('fuzzyFilter', () => {
  const items = ['Open File', 'Close File', 'Save As', 'Open Folder']

  test('keeps only matches, best score first', () => {
    const out = fuzzyFilter('open', items, (s) => s)
    expect(out.map((r) => r.item)).toEqual(['Open File', 'Open Folder'])
  })

  test('empty query is an identity filter preserving order', () => {
    const out = fuzzyFilter('', items, (s) => s)
    expect(out.map((r) => r.item)).toEqual(items)
  })

  test('carries highlight indices for each ranked item', () => {
    const out = fuzzyFilter('sa', items, (s) => s)
    expect(out[0]!.item).toBe('Save As')
    expect(out[0]!.indices.length).toBe(2)
  })
})
