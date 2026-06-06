import { type Pointer, toArrayBuffer } from "bun:ffi";
import { loadNativeLib } from "./native/load-native-lib.ts";
import { CELL_BYTES, NodeKindCode, Status } from "./native/ffi-symbols.ts";
import { VuiNode } from "./node.ts";
import { type OffscreenBuffer } from "./offscreen-buffer.ts";
import type { TextBufferView } from "./text/text-buffer-view.ts";
import type { EditorView } from "./text/editor-view.ts";

/** Pack 8-bit channels into the `0xRRGGBBAA` u32 the FFI expects. */
export function rgba(r: number, g: number, b: number, a = 255): number {
  return (
    (((r & 0xff) << 24) |
      ((g & 0xff) << 16) |
      ((b & 0xff) << 8) |
      (a & 0xff)) >>>
    0
  );
}

export interface TextStyle {
  fg?: number;
  bg?: number;
  attrs?: number;
}

/** Half-open clip rect `[x0,x1) × [y0,y1)`; the JS twin of the native `ClipRect`. */
export interface ClipRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DEFAULT_FG = rgba(229, 229, 229);
const DEFAULT_BG = rgba(0, 0, 0);
const encoder = new TextEncoder();

function check(status: number, op: string): void {
  if (status !== Status.OK) {
    throw new Error(`vui-core ${op} failed with status ${status}`);
  }
}

/**
 * Thin, safe wrapper over the native renderer. Owns a `*mut Renderer` and
 * mirrors the draw primitives. Drawing mutates the back buffer; `render()`
 * diffs it against the screen and writes the minimal frame to stdout.
 *
 * Call `free()` exactly once when done — the instance must not be used after.
 */
export class Renderer {
  #lib = loadNativeLib();
  #ptr: Pointer;
  #width: number;
  #height: number;
  /** Reused scratch for clip rects passed to the native clipped prims (no per-op alloc). */
  #clip = new Int32Array(4);

  constructor(width: number, height: number) {
    const ptr = this.#lib.symbols.vui_renderer_new(width, height);
    if (ptr === null) {
      throw new Error("vui-core: failed to allocate renderer");
    }
    this.#ptr = ptr;
    this.#width = width;
    this.#height = height;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  drawText(x: number, y: number, text: string, style: TextStyle = {}): void {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_buffer_draw_text(
        this.#ptr,
        x,
        y,
        bytes,
        bytes.byteLength,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
      ),
      "draw_text",
    );
  }

  fillRect(x: number, y: number, w: number, h: number, bg: number): void {
    check(
      this.#lib.symbols.vui_buffer_fill_rect(this.#ptr, x, y, w, h, bg),
      "fill_rect",
    );
  }

  setCell(x: number, y: number, ch: number, style: TextStyle = {}): void {
    check(
      this.#lib.symbols.vui_buffer_set_cell(
        this.#ptr,
        x,
        y,
        ch,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
      ),
      "set_cell",
    );
  }

  clear(bg: number = DEFAULT_BG): void {
    check(this.#lib.symbols.vui_buffer_clear(this.#ptr, bg), "clear");
  }

  // --- Clip-aware primitives: the JS paint walk's draw surface (Phase 04). ---
  // Signed coords + a clip rect (passed as a 4-i32 buffer); the in-Rust loop
  // drops out-of-bounds cells, so one FFI call paints a whole text run/rect.

  #packClip(clip: ClipRect): Int32Array {
    this.#clip[0] = clip.x0;
    this.#clip[1] = clip.y0;
    this.#clip[2] = clip.x1;
    this.#clip[3] = clip.y1;
    return this.#clip;
  }

  drawTextClipped(
    x: number,
    y: number,
    text: string,
    style: TextStyle,
    clip: ClipRect,
  ): void {
    const bytes = encoder.encode(text);
    check(
      this.#lib.symbols.vui_buffer_draw_text_clipped(
        this.#ptr,
        x,
        y,
        bytes,
        bytes.byteLength,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
        this.#packClip(clip),
      ),
      "draw_text_clipped",
    );
  }

  fillRectClipped(
    x: number,
    y: number,
    w: number,
    h: number,
    bg: number,
    clip: ClipRect,
  ): void {
    check(
      this.#lib.symbols.vui_buffer_fill_rect_clipped(
        this.#ptr,
        x,
        y,
        w,
        h,
        bg,
        this.#packClip(clip),
      ),
      "fill_rect_clipped",
    );
  }

  setCellClipped(
    x: number,
    y: number,
    ch: number,
    style: TextStyle,
    clip: ClipRect,
  ): void {
    check(
      this.#lib.symbols.vui_buffer_set_cell_clipped(
        this.#ptr,
        x,
        y,
        ch,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.attrs ?? 0,
        this.#packClip(clip),
      ),
      "set_cell_clipped",
    );
  }

  /** Composite an offscreen buffer into the back buffer at `(dstX, dstY)`, clipped. */
  blit(src: OffscreenBuffer, dstX: number, dstY: number, clip: ClipRect): void {
    check(
      this.#lib.symbols.vui_buffer_blit(
        this.#ptr,
        src.nativePtr,
        dstX,
        dstY,
        this.#packClip(clip),
      ),
      "blit",
    );
  }

  /** Draw a native text-buffer view into the back buffer, clipped. */
  drawTextBuffer(
    view: TextBufferView,
    x: number,
    y: number,
    style: TextStyle,
    clip: ClipRect,
  ): void {
    check(
      this.#lib.symbols.vui_buffer_draw_textbuffer(
        this.#ptr,
        view.nativePtr,
        x,
        y,
        style.fg ?? DEFAULT_FG,
        style.bg ?? 0,
        style.bg === undefined ? 0 : 1,
        style.attrs ?? 0,
        this.#packClip(clip),
      ),
      "draw_textbuffer",
    );
  }

  /** Draw a native editor view, including its cursor when focused. */
  drawEditor(
    view: EditorView,
    x: number,
    y: number,
    style: TextStyle & { cursorBg?: number },
    clip: ClipRect,
  ): void {
    check(
      this.#lib.symbols.vui_buffer_draw_editor(
        this.#ptr,
        view.nativePtr,
        x,
        y,
        style.fg ?? DEFAULT_FG,
        style.bg ?? DEFAULT_BG,
        style.cursorBg ?? style.fg ?? DEFAULT_FG,
        style.attrs ?? 0,
        this.#packClip(clip),
      ),
      "draw_editor",
    );
  }

  /** Diff the back buffer and write the frame to stdout. */
  render(): void {
    check(this.#lib.symbols.vui_renderer_render(this.#ptr), "render");
  }

  /**
   * JS-host emit: diff + write the back buffer exactly as it was drawn, WITHOUT
   * composing the native node tree. The JS paint walk clears + stamps the back
   * buffer (via the clip-aware prims), then calls this to flush the frame.
   */
  flush(): void {
    check(this.#lib.symbols.vui_renderer_flush(this.#ptr), "flush");
  }

  /** Drop all staged OSC 8 links; call before re-staging a frame's link table. */
  clearLinks(): void {
    check(this.#lib.symbols.vui_renderer_clear_links(this.#ptr), "clear_links");
  }

  /**
   * Stage raw escape bytes to emit out-of-band on the next frame (image transmit,
   * OSC 52 clipboard). Host-built sequences ONLY — never user text. A non-empty
   * channel forces a frame; it clears after emit. Multiple calls concatenate.
   */
  stagePassthrough(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    check(
      this.#lib.symbols.vui_renderer_stage_passthrough(this.#ptr, bytes, bytes.byteLength),
      "stage_passthrough",
    );
  }

  /** Drop all Kitty image placements; call before re-staging a frame's placements. */
  clearImagePlacements(): void {
    check(
      this.#lib.symbols.vui_renderer_clear_image_placements(this.#ptr),
      "clear_image_placements",
    );
  }

  /** Register image `id`'s on-screen top-left cell for placeholder placement. */
  stageImagePlacement(id: number, x0: number, y0: number): void {
    check(
      this.#lib.symbols.vui_renderer_stage_image_placement(this.#ptr, id, x0, y0),
      "stage_image_placement",
    );
  }

  /**
   * Stage one OSC 8 link table entry (`id` → URI). The emitter wraps cells whose
   * `attrs` high byte equals `id` in the hyperlink. `id` 0 is "no link" (ignored).
   */
  stageLink(id: number, uri: string): void {
    const bytes = encoder.encode(uri);
    check(
      this.#lib.symbols.vui_renderer_stage_link(this.#ptr, id, bytes, bytes.byteLength),
      "stage_link",
    );
  }

  /**
   * The implicit root node, created with the renderer and sized to the terminal.
   * Build the UI as its descendants; `render()` lays out and paints the tree.
   */
  rootNode(): VuiNode {
    const id = this.#lib.symbols.vui_renderer_set_root(this.#ptr);
    return new VuiNode(this.#lib, this.#ptr, id, 0);
  }

  /** Create a detached node (`"box"`, `"text"`, or `"edit"`); attach under a parent. */
  createNode(kind: "box" | "text" | "edit"): VuiNode {
    const code =
      kind === "text"
        ? NodeKindCode.Text
        : kind === "edit"
          ? NodeKindCode.Edit
          : NodeKindCode.Box;
    const id = this.#lib.symbols.vui_node_new(this.#ptr, code);
    if (id === 0) {
      throw new Error("vui-core: failed to create node");
    }
    return new VuiNode(this.#lib, this.#ptr, id, code);
  }

  /** Native structural hash of the tree; compare to `hostTreeHash` for desync. */
  treeHash(): bigint {
    return this.#lib.symbols.vui_debug_tree_hash(this.#ptr);
  }

  /**
   * Run taffy layout over the node tree (JS-host path) WITHOUT painting, sizing
   * to the terminal by default. Read each node's box with `VuiNode.layoutRect`.
   * Dirty-gate on the caller side (skip when no style/text changed).
   */
  computeLayout(
    width: number = this.#width,
    height: number = this.#height,
  ): void {
    check(
      this.#lib.symbols.vui_layout_compute(this.#ptr, width, height),
      "layout_compute",
    );
  }

  /** Reallocate to a new size; forces a full repaint on the next `render()`. */
  resize(width: number, height: number): void {
    check(
      this.#lib.symbols.vui_renderer_resize(this.#ptr, width, height),
      "resize",
    );
    this.#width = width;
    this.#height = height;
  }

  /**
   * Zero-copy `Uint8Array` view over the native back buffer (stride
   * `CELL_BYTES`). The view aliases native memory and is NOT lifetime-tracked:
   * it dangles after `resize()` (reallocates) or `free()` (deallocates). Do not
   * retain a view across either call — fetch a fresh one each time. Intended for
   * bulk writes and tests; prefer the draw methods for normal use. Raw writes
   * must uphold the wide-glyph pairing invariant the draw methods maintain: a
   * WIDE_CONTINUATION cell sits immediately right of a width-2 leader and only
   * there — so when clearing a continuation cell, also blank its leader (and
   * vice versa), or a half-glyph can linger on screen.
   */
  backBufferView(): Uint8Array {
    const ptr = this.#lib.symbols.vui_renderer_back_buffer_ptr(this.#ptr);
    if (ptr === null) {
      throw new Error("vui-core: back buffer pointer is null");
    }
    const cells = Number(this.#lib.symbols.vui_renderer_buffer_len(this.#ptr));
    return new Uint8Array(toArrayBuffer(ptr, 0, cells * CELL_BYTES));
  }

  /** Free the native renderer. Idempotent; the instance is unusable after. */
  free(): void {
    if (this.#ptr !== null) {
      this.#lib.symbols.vui_renderer_free(this.#ptr);
      this.#ptr = null as unknown as Pointer;
    }
  }
}
