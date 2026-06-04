import { describe, expect, test } from "bun:test";
import { hitTest } from "../src/host/hit-test.ts";
import { type HostContext, Renderable } from "../src/host/renderable.ts";

function node(tag: string, rect: { x0: number; y0: number; x1: number; y1: number }): Renderable {
  const n = new Renderable({} as HostContext, "box", tag);
  n.screenRect = rect;
  return n;
}

function append(parent: Renderable, child: Renderable): Renderable {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

describe("hitTest", () => {
  test("returns the deepest painted node containing the cell", () => {
    const root = node("root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const child = append(root, node("child", { x0: 2, y0: 2, x1: 10, y1: 6 }));
    const grandchild = append(child, node("grandchild", { x0: 4, y0: 3, x1: 8, y1: 5 }));
    expect(hitTest(root, 5, 4)).toBe(grandchild);
    expect(hitTest(root, 3, 3)).toBe(child);
  });

  test("later overlapping siblings are topmost", () => {
    const root = node("root", { x0: 0, y0: 0, x1: 20, y1: 10 });
    const first = append(root, node("first", { x0: 2, y0: 2, x1: 12, y1: 8 }));
    const second = append(root, node("second", { x0: 4, y0: 3, x1: 14, y1: 9 }));
    expect(hitTest(root, 5, 4)).toBe(second);
    expect(hitTest(root, 3, 3)).toBe(first);
  });

  test("uses half-open edges and skips out-of-bounds cells", () => {
    const root = node("root", { x0: 0, y0: 0, x1: 5, y1: 3 });
    expect(hitTest(root, 4, 2)).toBe(root);
    expect(hitTest(root, 5, 2)).toBeNull();
    expect(hitTest(root, 4, 3)).toBeNull();
  });
});
