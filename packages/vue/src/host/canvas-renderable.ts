// The payoff of the JS host: first-class custom drawing. A `<canvas @draw>` node
// runs a user callback that draws freely into the cell buffer, clamped + clipped
// to the canvas's laid-out content box. Two flavors:
//   - direct  — `onDraw` writes straight into the back buffer each paint.
//   - buffered — `onDraw` writes into an offscreen buffer, ONLY when dirty, and
//                the canvas blits that cached framebuffer each frame (cheap for
//                static/expensive content; the OpenTUI `FrameBufferRenderable`).
// A canvas lays out as a leaf box (kind "box": gets a rect, flexes, can have a
// bg/border/title), so it composes with sibling widgets by construction.
import { OffscreenBuffer } from "@vui-rs/core";
import { DEFAULT_BG, DEFAULT_FG, drawChrome } from "./paint-ops.ts";
import { type Clip, type HostContext, type PaintBuffer, type PaintCtx, Renderable } from "./renderable.ts";

/** Optional per-cell style for the canvas draw ops. */
export interface CanvasStyle {
  fg?: number;
  bg?: number;
  attrs?: number;
}

/** The laid-out rect handed to `onDraw` (absolute cells). Local draw coords are 0-based. */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The clamped drawing surface passed to a canvas's `onDraw`. Coordinates are
 * LOCAL to the canvas content box (0,0 = its top-left); every op is clipped to
 * the box so a canvas can never corrupt a sibling.
 */
export interface CanvasContext {
  readonly width: number;
  readonly height: number;
  clear(bg?: number): void;
  fillRect(x: number, y: number, w: number, h: number, bg: number): void;
  setCell(x: number, y: number, ch: string | number, style?: CanvasStyle): void;
  drawText(x: number, y: number, text: string, style?: CanvasStyle): void;
}

export type CanvasDraw = (ctx: CanvasContext, rect: CanvasRect) => void;

const toCp = (ch: string | number): number =>
  typeof ch === "number" ? ch : (ch.codePointAt(0) ?? 32);

export class CanvasRenderable extends Renderable {
  #off: OffscreenBuffer | null = null;
  #w = 0;
  #h = 0;
  #contentDirty = true;
  /** Number of `onDraw` invocations — instrumentation for the buffered-redraw test. */
  drawCount = 0;

  constructor(ctx: HostContext, tag: string) {
    super(ctx, "box", tag); // lays out as a leaf box
  }

  /** Buffered mode owns an offscreen framebuffer; toggled by the `buffered` prop. */
  get buffered(): boolean {
    return this.props.buffered === true;
  }

  /** Force a buffered canvas to re-run `onDraw` on the next paint. */
  redraw(): void {
    this.#contentDirty = true;
    this.markDirty();
    this.ctx.scheduleRender();
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint); // bg fill + border + title around the content box
    const onDraw = this.events.get("draw") as CanvasDraw | undefined;
    const w = ctx.cx1 - ctx.cx0;
    const h = ctx.cy1 - ctx.cy0;
    if (!onDraw || w <= 0 || h <= 0) {
      this.#freeOffscreen();
      return;
    }
    const rect: CanvasRect = { x: ctx.cx0, y: ctx.cy0, width: w, height: h };

    if (this.buffered) {
      if (!this.#off || this.#w !== w || this.#h !== h) {
        this.#freeOffscreen();
        this.#off = new OffscreenBuffer(w, h);
        this.#w = w;
        this.#h = h;
        this.#contentDirty = true;
      }
      if (this.#contentDirty) {
        this.#off.clear(this.paint.bg ?? DEFAULT_BG);
        onDraw(bufferedContext(this.#off), rect);
        this.drawCount++;
        this.#contentDirty = false;
      }
      buffer.blit(this.#off, ctx.cx0, ctx.cy0, ctx.contentClip);
    } else {
      // Direct mode owns no framebuffer; release one left over from a prior
      // `buffered:true` (a buffered→direct switch must not leak it until unmount).
      this.#freeOffscreen();
      onDraw(directContext(buffer, ctx.cx0, ctx.cy0, w, h, ctx.contentClip), rect);
      this.drawCount++;
    }
  }

  dispose(): void {
    this.#freeOffscreen();
  }

  #freeOffscreen(): void {
    if (this.#off) {
      this.#off.free();
      this.#off = null;
      this.#w = 0;
      this.#h = 0;
    }
  }
}

/** Direct surface: ops translate into the back buffer at the content origin, clipped. */
function directContext(buf: PaintBuffer, cx0: number, cy0: number, w: number, h: number, clip: Clip): CanvasContext {
  return {
    width: w,
    height: h,
    clear(bg = DEFAULT_BG) {
      buf.fillRect(cx0, cy0, w, h, bg, clip);
    },
    fillRect(x, y, rw, rh, bg) {
      buf.fillRect(cx0 + x, cy0 + y, rw, rh, bg, clip);
    },
    setCell(x, y, ch, style = {}) {
      buf.setCell(cx0 + x, cy0 + y, toCp(ch), style.fg ?? DEFAULT_FG, style.bg ?? DEFAULT_BG, style.attrs ?? 0, clip);
    },
    drawText(x, y, text, style = {}) {
      buf.drawText(cx0 + x, cy0 + y, text, style.fg ?? DEFAULT_FG, style.bg ?? DEFAULT_BG, style.attrs ?? 0, clip);
    },
  };
}

/** Buffered surface: ops draw into the offscreen buffer (which clips to its own bounds). */
function bufferedContext(off: OffscreenBuffer): CanvasContext {
  return {
    width: off.width,
    height: off.height,
    clear(bg = DEFAULT_BG) {
      off.clear(bg);
    },
    fillRect(x, y, w, h, bg) {
      off.fillRect(x, y, w, h, bg);
    },
    setCell(x, y, ch, style = {}) {
      off.setCell(x, y, toCp(ch), { fg: style.fg, bg: style.bg, attrs: style.attrs });
    },
    drawText(x, y, text, style = {}) {
      off.drawText(x, y, text, { fg: style.fg, bg: style.bg, attrs: style.attrs });
    },
  };
}
