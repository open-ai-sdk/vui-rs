// A safe handle over one native render node. Owns no memory itself (the native
// tree does); it just forwards typed calls by `(renderer, nodeId)`. It also keeps
// a lightweight JS mirror of kind + children so the host can compute the same
// structural hash the native side does (`hostTreeHash`) and assert the two trees
// never diverge.

import type { Pointer } from "bun:ffi";
import {
  NativeTextWrap,
  RECT_FFI_BYTES,
  Status,
  TEXT_RUN_FFI_BYTES,
} from "./native/ffi-symbols.ts";
import type { NativeLib } from "./native/load-native-lib.ts";
import { packStyle, type VuiStyle } from "./style.ts";

const encoder = new TextEncoder();

export interface TextRun {
  text: string;
  fg?: number;
  bg?: number;
  attrs?: number;
}

export type TextWrapName = "word" | "char" | "nowrap";

/** Per-side insets (cells, fractional) reported by layout. */
export interface RectEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A node's computed taffy box: parent-relative origin + size + padding/border insets. */
export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  padding: RectEdges;
  border: RectEdges;
}

// Reused scratch for `layoutRect` readback — one float per RectFfi byte-quartet
// (derived from the ABI constant so a field add can't leave it short). Read
// synchronously after the FFI call on a single thread, so one shared buffer is safe.
const rectScratch = new Float32Array(RECT_FFI_BYTES / 4);

function check(status: number, op: string): void {
  if (status !== Status.OK) {
    throw new Error(`vui-core node ${op} failed with status ${status}`);
  }
}

export class VuiNode {
  readonly id: number;
  /** Node-kind code mirrored for the structural hash (0 root, 1 box, 2 text). */
  readonly kindCode: number;
  /** JS mirror of the native child order — kept in lockstep by the tree ops. */
  readonly children: VuiNode[] = [];
  #parent: VuiNode | undefined;
  #lib: NativeLib;
  #ptr: Pointer;

  constructor(lib: NativeLib, ptr: Pointer, id: number, kindCode: number) {
    this.#lib = lib;
    this.#ptr = ptr;
    this.id = id;
    this.kindCode = kindCode;
  }

  setStyle(style: VuiStyle): this {
    const bytes = packStyle(style);
    check(
      this.#lib.symbols.vui_node_set_style(this.#ptr, this.id, bytes),
      "set_style",
    );
    return this;
  }

  /**
   * This node's computed layout box after `Renderer.computeLayout`, or `null` if
   * layout hasn't run yet (or the handle is stale). The JS-host paint walk reads
   * these to place each Renderable.
   */
  layoutRect(): LayoutRect | null {
    const status = this.#lib.symbols.vui_node_rect(
      this.#ptr,
      this.id,
      rectScratch,
    );
    if (status !== Status.OK) return null;
    return {
      x: rectScratch[0]!,
      y: rectScratch[1]!,
      w: rectScratch[2]!,
      h: rectScratch[3]!,
      padding: {
        left: rectScratch[4]!,
        right: rectScratch[5]!,
        top: rectScratch[6]!,
        bottom: rectScratch[7]!,
      },
      border: {
        left: rectScratch[8]!,
        right: rectScratch[9]!,
        top: rectScratch[10]!,
        bottom: rectScratch[11]!,
      },
    };
  }

  setText(text: string): this {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_node_set_text(
        this.#ptr,
        this.id,
        bytes,
        bytes.byteLength,
      ),
      "set_text",
    );
    return this;
  }

  setTextRuns(runs: TextRun[]): this {
    const { bytes, runBytes } = packTextRuns(runs);
    check(
      this.#lib.symbols.vui_node_set_text_runs(
        this.#ptr,
        this.id,
        runBytes,
        runs.length,
        bytes,
        bytes.byteLength,
      ),
      "set_text_runs",
    );
    return this;
  }

  /**
   * Text flow for a `<text>` node: `"word"` (default) breaks at word
   * boundaries with char fallback, `"char"` wraps by grapheme, and `"nowrap"`
   * keeps each physical line on one row and clips overflow.
   */
  setTextWrap(mode: TextWrapName): this {
    check(
      this.#lib.symbols.vui_node_set_text_wrap(
        this.#ptr,
        this.id,
        wrapCode(mode),
      ),
      "set_text_wrap",
    );
    return this;
  }

  appendChild(child: VuiNode): this {
    check(
      this.#lib.symbols.vui_node_append_child(this.#ptr, this.id, child.id),
      "append_child",
    );
    child.#detachFromParent();
    child.#parent = this;
    this.children.push(child);
    return this;
  }

  insertBefore(child: VuiNode, anchor: VuiNode): this {
    check(
      this.#lib.symbols.vui_node_insert_before(
        this.#ptr,
        this.id,
        child.id,
        anchor.id,
      ),
      "insert_before",
    );
    child.#detachFromParent();
    child.#parent = this;
    const at = this.children.indexOf(anchor);
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    return this;
  }

  removeChild(child: VuiNode): this {
    check(
      this.#lib.symbols.vui_node_remove_child(this.#ptr, this.id, child.id),
      "remove_child",
    );
    child.#detachFromParent();
    return this;
  }

  /** Destroy this node and its subtree natively, and unlink it from the mirror. */
  free(): void {
    check(this.#lib.symbols.vui_node_free(this.#ptr, this.id), "free");
    this.#detachFromParent();
  }

  #detachFromParent(): void {
    if (!this.#parent) return;
    const siblings = this.#parent.children;
    const at = siblings.indexOf(this);
    if (at >= 0) siblings.splice(at, 1);
    this.#parent = undefined;
  }
}

export function packTextRuns(runs: TextRun[]): {
  bytes: Uint8Array;
  runBytes: Uint8Array;
} {
  const chunks = runs.map((r) => encoder.encode(r.text));
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const bytes = new Uint8Array(total);
  const runBuf = new ArrayBuffer(runs.length * TEXT_RUN_FFI_BYTES);
  const dv = new DataView(runBuf);
  let off = 0;
  runs.forEach((run, i) => {
    const chunk = chunks[i]!;
    bytes.set(chunk, off);
    const base = i * TEXT_RUN_FFI_BYTES;
    dv.setUint32(base + 0, off, true);
    dv.setUint32(base + 4, chunk.byteLength, true);
    dv.setUint32(base + 8, (run.fg ?? 0) >>> 0, true);
    dv.setUint32(base + 12, (run.bg ?? 0) >>> 0, true);
    dv.setUint16(base + 16, (run.attrs ?? 0) & 0xffff, true);
    dv.setUint8(base + 18, run.fg !== undefined ? 1 : 0);
    dv.setUint8(base + 19, run.bg !== undefined ? 1 : 0);
    off += chunk.byteLength;
  });
  return { bytes, runBytes: new Uint8Array(runBuf) };
}

function wrapCode(mode: TextWrapName): number {
  if (mode === "nowrap") return NativeTextWrap.None;
  if (mode === "char") return NativeTextWrap.Char;
  return NativeTextWrap.Word;
}

// FNV-1a 64-bit, mirroring `node::NodeTree::debug_tree_hash` exactly so the host
// can assert its mirror matches the native tree.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;

function mix(h: bigint, v: bigint): bigint {
  h ^= v & U64;
  return (h * FNV_PRIME) & U64;
}

function hashNode(node: VuiNode, h: bigint): bigint {
  h = mix(h, BigInt(node.kindCode));
  h = mix(h, BigInt(node.children.length));
  for (const c of node.children) h = mix(h, BigInt(c.id));
  for (const c of node.children) h = hashNode(c, h);
  return h;
}

/** Structural hash of the host mirror, comparable to `Renderer.treeHash()`. */
export function hostTreeHash(root: VuiNode): bigint {
  return hashNode(root, FNV_OFFSET);
}
