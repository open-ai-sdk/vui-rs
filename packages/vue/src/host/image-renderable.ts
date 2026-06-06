// An `<image src>` node: decodes a file OR a remote `http(s)://` URL and paints it
// inside its laid-out content box. Local paths decode synchronously each paint;
// remote URLs are fetched ONCE (async), cached as bytes, and decoded from memory —
// the node renders nothing until the fetch resolves, then marks itself dirty so the
// image appears. It lays out as a leaf box (kind "box"), so it sizes like any
// widget. Encoding is picked per session (Kitty → iTerm2 → half-block); half-block
// always works and composes with the cell-diff renderer, so it is the floor.
import { type DecodedImage, decodeImage, decodeImageBytes } from '@vui-rs/core'
import { drawChrome } from './paint-ops.ts'
import { type PaintBuffer, type PaintCtx, Renderable, type HostContext } from './renderable.ts'
import {
  buildKittyTransmit,
  CELL_PX_H,
  CELL_PX_W,
  imageId,
  paintHalfBlock,
  paintKittyPlaceholders,
  selectImageEncoding,
} from './image-encode.ts'

type RemoteState = 'idle' | 'pending' | 'ready' | 'error'

export class ImageRenderable extends Renderable {
  #cacheKey = ''
  #cacheImg: DecodedImage | null = null
  /** Cache key for which decoded image has already been transmitted to a Kitty terminal. */
  #transmittedKey = ''
  // Remote-fetch state for an `http(s)://` src (per the current url).
  #remoteUrl = ''
  #remoteState: RemoteState = 'idle'
  #remoteBytes: Uint8Array | null = null

  constructor(ctx: HostContext, tag: string) {
    super(ctx, 'box', tag) // lays out as a leaf box
  }

  get src(): string {
    return typeof this.props.src === 'string' ? this.props.src : ''
  }

  renderSelf(buffer: PaintBuffer, ctx: PaintCtx): void {
    drawChrome(buffer, ctx, this.paint) // bg/border/title around the content box
    const cols = ctx.cx1 - ctx.cx0
    const rows = ctx.cy1 - ctx.cy0
    const src = this.src
    if (!src || cols <= 0 || rows <= 0) return

    // Remote source: ensure it is fetched; render nothing until the bytes arrive.
    if (isRemote(src)) {
      this.#ensureFetched(src)
      if (this.#remoteState !== 'ready' || !this.#remoteBytes) return
    }

    // Kitty graphics: high-fidelity native placement via Unicode placeholders. The
    // image is decoded to its cell-pixel size, transmitted once (cached by id), and
    // displayed by a block of placeholder cells the renderer expands at emit time.
    if (selectImageEncoding() === 'kitty' && this.ctx.renderer) {
      const img = this.#decode(src, cols * CELL_PX_W, rows * CELL_PX_H)
      if (!img) return
      const id = imageId(src, cols, rows)
      if (this.#transmittedKey !== this.#cacheKey) {
        this.ctx.renderer.stagePassthrough(buildKittyTransmit(id, img, cols, rows))
        this.#transmittedKey = this.#cacheKey
      }
      this.ctx.renderer.stageImagePlacement(id, ctx.cx0, ctx.cy0)
      paintKittyPlaceholders(buffer, ctx.cx0, ctx.cy0, cols, rows, id, ctx.contentClip)
      return
    }

    // Half-block (default + the floor for iTerm2/unknown terminals): two vertical
    // pixels per cell, so fit to cols × 2·rows px. Zero escapes — composes with the
    // cell diff on every truecolor terminal.
    const img = this.#decode(src, cols, rows * 2)
    if (!img) return // decode failed → render nothing (chrome already drawn)
    paintHalfBlock(buffer, ctx.cx0, ctx.cy0, img, ctx.contentClip)
  }

  /** Kick off a one-time fetch for a remote `src` (no-op once started for that url). */
  #ensureFetched(url: string): void {
    if (this.#remoteUrl === url) return // already fetching/fetched this url
    this.#remoteUrl = url
    this.#remoteState = 'pending'
    this.#remoteBytes = null
    this.#cacheKey = '' // invalidate any decode cached from a previous src
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buf) => {
        if (this.#remoteUrl !== url) return // src changed mid-flight
        this.#remoteBytes = new Uint8Array(buf)
        this.#remoteState = 'ready'
        this.#transmittedKey = '' // force a Kitty re-transmit now bytes exist
        this.markDirty()
        this.ctx.scheduleRender()
      })
      .catch(() => {
        if (this.#remoteUrl === url) this.#remoteState = 'error'
      })
  }

  #decode(src: string, maxW: number, maxH: number): DecodedImage | null {
    const key = `${src}:${maxW}x${maxH}`
    if (this.#cacheKey === key) return this.#cacheImg
    this.#cacheImg =
      isRemote(src) && this.#remoteBytes
        ? decodeImageBytes(this.#remoteBytes, maxW, maxH)
        : isRemote(src)
          ? null
          : decodeImage(src, maxW, maxH)
    this.#cacheKey = key
    return this.#cacheImg
  }
}

function isRemote(src: string): boolean {
  return src.startsWith('http://') || src.startsWith('https://')
}
