// A frame-stable URI → link-id map for OSC 8 hyperlinks. The host assigns each
// distinct URI a small stable id (1..255) that it ORs into a cell run's `attrs`
// high byte; the renderer wraps equal-id cell runs in a hyperlink, reading the
// URI from the staged table. Ids are STABLE for the app's lifetime (not reset per
// frame) so a `<text>`'s cached runs — built once, reused across frames — keep
// their baked-in ids coherent with the table re-staged each frame. Id 0 is
// reserved for "no link"; the 256th distinct URI and beyond fall back to 0 (the
// link is simply not rendered) rather than colliding with an existing id.
export class LinkRegistry {
  #byUri = new Map<string, number>();
  #next = 1;

  /** Stable id for `uri` (assigning one on first sight). 0 if the table is full. */
  idFor(uri: string): number {
    const existing = this.#byUri.get(uri);
    if (existing !== undefined) return existing;
    if (this.#next > 255) return 0; // one-byte id space exhausted: render unlinked
    const id = this.#next++;
    this.#byUri.set(uri, id);
    return id;
  }

  /** All `(id, uri)` entries, for staging the renderer's link table each frame. */
  entries(): Array<[number, string]> {
    return Array.from(this.#byUri, ([uri, id]) => [id, uri]);
  }

  get size(): number {
    return this.#byUri.size;
  }
}
