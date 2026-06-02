// The 10 `RendererOptions` ops Vue needs (the optional query/clone/static ones
// are skipped). Each op keeps the JS mirror tree and the Rust render-node tree in
// lockstep: structural ops on `box`/`text` nodes call the Rust tree, while
// `span`/`raw-text`/`comment` nodes live only in JS and re-pack their enclosing
// `<text>`'s runs on flush.
import type { RendererOptions } from "@vue/runtime-core";
import {
  type VuiContext,
  type VuiHostNode,
  createHostComment,
  createHostElement,
  createHostText,
  detachFromParent,
  enclosingText,
  isNative,
  nextNativeSiblingCore,
} from "./host-node.ts";
import { patchProp } from "./patch-prop.ts";

export function createRendererOptions(
  ctx: VuiContext,
): RendererOptions<VuiHostNode, VuiHostNode> {
  function insert(child: VuiHostNode, parent: VuiHostNode, anchor?: VuiHostNode | null): void {
    detachFromParent(child);
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at < 0) parent.children.push(child);
    else parent.children.splice(at, 0, child);
    child.parent = parent;

    if (isNative(child)) {
      if (parent.kind !== "box") {
        throw new Error(
          `vui: <${child.tag}> cannot nest in <${parent.tag}> — boxes hold boxes/text, text holds strings`,
        );
      }
      const anchorCore = nextNativeSiblingCore(child);
      if (anchorCore) parent.core!.insertBefore(child.core!, anchorCore);
      else parent.core!.appendChild(child.core!);
    } else if (child.kind === "raw-text" || child.kind === "span") {
      const text = enclosingText(parent);
      if (!text) {
        throw new Error("vui: bare strings and inline spans must be wrapped in <text>");
      }
      text.directText = null;
      ctx.dirtyText.add(text);
    }
    // comment: inert fragment/anchor placeholder, JS mirror only.
    ctx.scheduleRender();
  }

  function remove(el: VuiHostNode): void {
    const parent = el.parent;
    if (el.focusable) ctx.focusManager?.release(el);
    detachFromParent(el);
    if (isNative(el)) {
      parent?.core?.removeChild(el.core!);
      ctx.dirtyStyle.delete(el);
      ctx.dirtyText.delete(el);
      ctx.pendingFree.push(el);
    } else if (el.kind === "raw-text" || el.kind === "span") {
      const text = parent ? enclosingText(parent) : null;
      if (text) ctx.dirtyText.add(text);
    }
    ctx.scheduleRender();
  }

  function setText(node: VuiHostNode, text: string): void {
    node.text = text;
    const owner = enclosingText(node);
    if (owner) {
      ctx.dirtyText.add(owner);
      ctx.scheduleRender();
    }
  }

  function setElementText(el: VuiHostNode, text: string): void {
    if (el.kind === "box") {
      if (text === "") return; // clearing children is fine; setting a string is not
      throw new Error("vui: bare strings must be wrapped in <text>");
    }
    // text / span: route the whole content to a single default-styled run.
    el.directText = text;
    const owner = enclosingText(el);
    if (owner) ctx.dirtyText.add(owner);
    ctx.scheduleRender();
  }

  return {
    createElement: (tag: string) => createHostElement(ctx, tag),
    createText: (text: string) => createHostText(ctx, text),
    createComment: (text: string) => createHostComment(ctx, text),
    setText,
    setElementText,
    insert,
    remove,
    parentNode: (node) => node.parent,
    nextSibling,
    patchProp,
  };
}

function nextSibling(node: VuiHostNode): VuiHostNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const at = parent.children.indexOf(node);
  return parent.children[at + 1] ?? null;
}
