import { describe, expect, test } from 'bun:test'
import { hitTest, hitTestTopmost } from '../src/host/hit-test.ts'
import { type HostContext, Renderable } from '../src/host/renderable.ts'

function node(tag: string, rect: { x0: number; y0: number; x1: number; y1: number }): Renderable {
  const n = new Renderable({} as HostContext, 'box', tag)
  n.screenRect = rect
  return n
}

function append(parent: Renderable, child: Renderable): Renderable {
  child.parent = parent
  parent.children.push(child)
  return child
}

describe('hitTest', () => {
  test('returns the deepest painted node containing the cell', () => {
    const root = node('root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const child = append(root, node('child', { x0: 2, y0: 2, x1: 10, y1: 6 }))
    const grandchild = append(child, node('grandchild', { x0: 4, y0: 3, x1: 8, y1: 5 }))
    expect(hitTest(root, 5, 4)).toBe(grandchild)
    expect(hitTest(root, 3, 3)).toBe(child)
  })

  test('later overlapping siblings are topmost', () => {
    const root = node('root', { x0: 0, y0: 0, x1: 20, y1: 10 })
    const first = append(root, node('first', { x0: 2, y0: 2, x1: 12, y1: 8 }))
    const second = append(root, node('second', { x0: 4, y0: 3, x1: 14, y1: 9 }))
    expect(hitTest(root, 5, 4)).toBe(second)
    expect(hitTest(root, 3, 3)).toBe(first)
  })

  test('uses half-open edges and skips out-of-bounds cells', () => {
    const root = node('root', { x0: 0, y0: 0, x1: 5, y1: 3 })
    expect(hitTest(root, 4, 2)).toBe(root)
    expect(hitTest(root, 5, 2)).toBeNull()
    expect(hitTest(root, 4, 3)).toBeNull()
  })
})

describe('hitTestTopmost — overlay layer', () => {
  function scene() {
    const root = node('root', { x0: 0, y0: 0, x1: 40, y1: 20 })
    const content = append(root, node('content', { x0: 0, y0: 0, x1: 40, y1: 20 }))
    // A screen-filling overlay (e.g. a toast host), registered on the overlay layer.
    const overlay = node('overlay', { x0: 0, y0: 0, x1: 40, y1: 20 })
    overlay.isOverlay = true
    append(root, overlay)
    const ctx = { root, overlays: [overlay] } as unknown as HostContext
    return { ctx, content, overlay }
  }

  test('a non-backdrop full-screen overlay lets clicks/wheel fall through to the tree', () => {
    const { ctx, content } = scene()
    // No backdrop, no toast box here → the toast host must not swallow the event.
    expect(hitTestTopmost(ctx, 5, 5)).toBe(content)
  })

  test('a toast box inside the overlay still claims its own cell', () => {
    const { ctx, overlay, content } = scene()
    const toast = append(overlay, node('toast', { x0: 30, y0: 0, x1: 40, y1: 3 }))
    expect(hitTestTopmost(ctx, 35, 1)).toBe(toast) // on the toast
    expect(hitTestTopmost(ctx, 5, 10)).toBe(content) // elsewhere falls through
  })

  test('a backdrop overlay captures over its whole inset (modal)', () => {
    const { ctx, overlay } = scene()
    overlay.paint.backdrop = { darken: 0.5 }
    expect(hitTestTopmost(ctx, 5, 5)).toBe(overlay)
  })
})
