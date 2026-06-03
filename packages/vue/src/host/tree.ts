// Structural helpers over the Renderable graph, shared by node-ops and
// patch-prop. The JS twins of the host-node.ts helpers (enclosingText / detach /
// sibling walks), but with no FFI mirror — the Renderable tree IS the tree.
import type { VuiNode } from "@vui-rs/core";
import { type Renderable } from "./renderable.ts";

/** Nearest enclosing `<text>` ancestor (inclusive), or null if outside one. */
export function enclosingText(node: Renderable | null): Renderable | null {
  for (let n = node; n; n = n.parent) {
    if (n.kind === "text") return n;
    if (n.kind === "box" || n.kind === "edit") return null; // a box/input breaks the chain
  }
  return null;
}

/** Unlink a node from its current parent's child array. */
export function detachFromParent(node: Renderable): void {
  const parent = node.parent;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parent = null;
}

/** A node that participates in layout/paint (box/text/edit), vs a virtual inline node. */
export function isLayoutNode(node: Renderable): boolean {
  return node.kind === "box" || node.kind === "text" || node.kind === "edit";
}

/** First following sibling that owns a layout node — the anchor for `insertBefore`. */
export function nextLayoutSibling(node: Renderable): VuiNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const at = parent.children.indexOf(node);
  for (let i = at + 1; i < parent.children.length; i++) {
    const sib = parent.children[i]!;
    if (sib.layoutNode) return sib.layoutNode;
  }
  return null;
}
