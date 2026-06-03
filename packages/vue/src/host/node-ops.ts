// The Vue `RendererOptions` for the JS host: every op mutates the `Renderable`
// graph directly — no FFI per op (the whole point of the migration). Structural
// ops keep parent/children in sync; inserting a string/span marks the enclosing
// `<text>` dirty so its runs re-flatten on the next paint. Text/comment nodes are
// tracking-only anchors (the v-for/v-if anchors Vue brackets fragments with).
import type { RendererOptions } from "@vue/runtime-core";
import { createRenderable } from "./catalogue.ts";
import { CommentRenderable, RawTextRenderable } from "./text-renderable.ts";
import { type HostContext, type Renderable } from "./renderable.ts";
import { patchProp } from "./patch-prop.ts";
import { detachFromParent, enclosingText, isLayoutNode, nextLayoutSibling } from "./tree.ts";

export function createNodeOps(ctx: HostContext): RendererOptions<Renderable, Renderable> {
  function insert(child: Renderable, parent: Renderable, anchor?: Renderable | null): void {
    detachFromParent(child);
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at < 0) parent.children.push(child);
    else parent.children.splice(at, 0, child);
    child.parent = parent;

    if (isLayoutNode(child)) {
      if (parent.kind !== "box") {
        throw new Error(
          `vui: <${child.tag}> cannot nest in <${parent.tag}> — boxes hold boxes/text, text holds strings`,
        );
      }
      // Mirror the structure into the layout-node tree (taffy), if present.
      if (child.layoutNode && parent.layoutNode) {
        const anchor = nextLayoutSibling(child);
        if (anchor) parent.layoutNode.insertBefore(child.layoutNode, anchor);
        else parent.layoutNode.appendChild(child.layoutNode);
      }
      ctx.dirtyLayout.add(parent);
    } else if (child.kind === "raw-text" || child.kind === "span") {
      const text = enclosingText(parent);
      if (!text) {
        // Vue brackets fragments (v-for / multi-root) with EMPTY text-node anchors
        // inserted into the enclosing container (often a <box>). Allow an empty
        // raw-text through as an inert anchor; only a non-empty bare string or an
        // inline span outside a <text> is the authoring mistake this guards.
        if (!(child.kind === "raw-text" && child.text === "")) {
          throw new Error("vui: bare strings and inline spans must be wrapped in <text>");
        }
      } else {
        text.directText = null;
        ctx.dirtyText.add(text);
        text.markDirty();
      }
    }
    // comment: inert fragment/anchor placeholder.
    parent.markDirty();
    ctx.scheduleRender();
  }

  function remove(el: Renderable): void {
    const parent = el.parent;
    if (el.focusable) ctx.focusManager?.release(el);
    detachFromParent(el);
    if (isLayoutNode(el)) {
      // Detach + free the layout subtree. Vue unmounts descendants with
      // doRemove=false, so only this top node gets remove(); native `free()`
      // reclaims the whole subtree to match. We must then null every descendant's
      // `layoutNode` handle and drop them from the dirty sets — otherwise a later
      // layout pass would call set_style/set_text_runs on a freed (stale) handle.
      // Layout-only nodes aren't painted, so an immediate free can't race a render.
      if (el.layoutNode) parent?.layoutNode?.removeChild(el.layoutNode);
      forgetLayoutSubtree(el);
      if (parent) ctx.dirtyLayout.add(parent);
    } else if (el.kind === "raw-text" || el.kind === "span") {
      const text = parent ? enclosingText(parent) : null;
      if (text) {
        ctx.dirtyText.add(text);
        text.markDirty();
      }
    }
    parent?.markDirty();
    ctx.scheduleRender();
  }

  function setText(node: Renderable, text: string): void {
    node.text = text;
    const owner = enclosingText(node);
    if (owner) {
      ctx.dirtyText.add(owner);
      owner.markDirty();
      ctx.scheduleRender();
    } else if (text !== "" && (node.kind === "raw-text" || node.kind === "span")) {
      throw new Error("vui: bare strings and inline spans must be wrapped in <text>");
    }
  }

  function setElementText(el: Renderable, text: string): void {
    if (el.kind === "box") {
      if (text === "") return; // clearing children is fine; setting a string is not
      throw new Error("vui: bare strings must be wrapped in <text>");
    }
    el.directText = text;
    const owner = enclosingText(el);
    if (owner) {
      ctx.dirtyText.add(owner);
      owner.markDirty();
    }
    ctx.scheduleRender();
  }

  /**
   * Free `top`'s native layout node (cascades to its subtree) and null every
   * descendant `layoutNode` handle, dropping each from the dirty sets — so no
   * later layout pass touches a freed handle.
   */
  function forgetLayoutSubtree(top: Renderable): void {
    const stack: Renderable[] = [top];
    // Free the native subtree once at the root; descendants are reclaimed with it.
    if (top.layoutNode) {
      try {
        top.layoutNode.free();
      } catch {
        // Stale handle (already reclaimed via an ancestor) — a no-op, not a crash.
      }
    }
    while (stack.length > 0) {
      const n = stack.pop()!;
      n.layoutNode = null;
      n.dispose(); // release native resources (e.g. a canvas's offscreen buffer)
      ctx.dirtyLayout.delete(n);
      ctx.dirtyText.delete(n);
      for (const child of n.children) stack.push(child);
    }
  }

  return {
    createElement: (tag: string) => createRenderable(ctx, tag),
    createText: (text: string) => new RawTextRenderable(ctx, text),
    createComment: (text: string) => new CommentRenderable(ctx, text),
    setText,
    setElementText,
    insert,
    remove,
    parentNode: (node) => node.parent,
    nextSibling,
    patchProp,
  };
}

function nextSibling(node: Renderable): Renderable | null {
  const parent = node.parent;
  if (!parent) return null;
  const at = parent.children.indexOf(node);
  return parent.children[at + 1] ?? null;
}
