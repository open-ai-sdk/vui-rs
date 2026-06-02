// JS↔Rust render-tree consistency. The host keeps a mirror of the native tree
// structure; `hostTreeHash` must match the native `vui_debug_tree_hash` for the
// same tree, and diverge when the structure differs. This is the guard that
// catches the host and native trees drifting out of lockstep.
import { describe, expect, test } from "bun:test";
import { hostTreeHash, packStyle, Renderer, STYLE_FFI_BYTES } from "../src/index.ts";

describe("render-node tree", () => {
  test("host hash matches native hash for the same tree", () => {
    const r = new Renderer(40, 10);
    try {
      const root = r.rootNode();
      const a = r.createNode("box");
      const b = r.createNode("text");
      root.appendChild(a);
      root.appendChild(b);
      expect(hostTreeHash(root)).toBe(r.treeHash());

      // A nested child: both hashes update together and stay equal.
      const inner = r.createNode("text");
      a.appendChild(inner);
      expect(hostTreeHash(root)).toBe(r.treeHash());
    } finally {
      r.free();
    }
  });

  test("reordering children changes the hash on both sides", () => {
    const r = new Renderer(40, 10);
    try {
      const root = r.rootNode();
      const a = r.createNode("box");
      const b = r.createNode("box");
      root.appendChild(a);
      root.appendChild(b);
      const before = r.treeHash();
      expect(hostTreeHash(root)).toBe(before);

      // Move `a` to the end: [b, a]. Both hashes change and still agree.
      root.removeChild(a);
      root.appendChild(a);
      expect(r.treeHash()).not.toBe(before);
      expect(hostTreeHash(root)).toBe(r.treeHash());
    } finally {
      r.free();
    }
  });

  test("freeing a node updates both trees consistently", () => {
    const r = new Renderer(40, 10);
    try {
      const root = r.rootNode();
      const a = r.createNode("box");
      const b = r.createNode("box");
      root.appendChild(a);
      root.appendChild(b);
      a.free();
      expect(hostTreeHash(root)).toBe(r.treeHash());
      expect(root.children.length).toBe(1);
    } finally {
      r.free();
    }
  });

  test("packed StyleFfi is the ABI-agreed size", () => {
    expect(packStyle({}).byteLength).toBe(STYLE_FFI_BYTES);
  });
});
