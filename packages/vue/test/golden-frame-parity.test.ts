// Phase 04 cutover GATE: cell-for-cell parity between the JS host (JS paint walk
// → renderSelf → native clip prims) and the retained FFI host (Rust tree paint).
// The same component tree is rendered into two renderers' back buffers; they must
// be byte-identical. This is the safety net that gates flipping the default — a
// single diverging cell (rounding, clip, wide-char, transparent bg) fails here.
import { describe, expect, test } from "bun:test";
import { CELL_BYTES, Renderer } from "@vui-rs/core";
import { createHostApp } from "../src/host/create-host-app.ts";
import { type Component, createApp, defineComponent, h } from "../src/index.ts";

/** Snapshot a renderer's back buffer (the view aliases native memory). */
function snapshot(r: Renderer): Uint8Array {
  return Uint8Array.from(r.backBufferView());
}

/** Render `render` via the FFI host and the JS host; return both back buffers. */
function renderBoth(render: () => unknown, w: number, hgt: number): { ffi: Uint8Array; js: Uint8Array } {
  const App: Component = defineComponent({ setup: () => render });

  const r1 = new Renderer(w, hgt);
  const ffiApp = createApp(App).mount({ renderer: r1, altScreen: false });
  const ffi = snapshot(r1);
  ffiApp.unmount();
  r1.free();

  const r2 = new Renderer(w, hgt);
  const jsApp = createHostApp(App).mount({ renderer: r2 });
  const js = snapshot(r2);
  jsApp.unmount();
  r2.free();

  return { ffi, js };
}

// Compare only the meaningful cell fields (ch:4, fg:4, bg:4, attrs:2 = 14 bytes);
// the trailing 2 bytes are `repr(C)` padding and hold indeterminate values.
const CELL_MEANINGFUL_BYTES = 14;

/** First differing cell `(x,y)` + decoded fields, or null if identical. */
function firstDiff(ffi: Uint8Array, js: Uint8Array, w: number): string | null {
  for (let i = 0; i < ffi.length; i += CELL_BYTES) {
    let same = true;
    for (let k = 0; k < CELL_MEANINGFUL_BYTES; k++) {
      if (ffi[i + k] !== js[i + k]) {
        same = false;
        break;
      }
    }
    if (!same) {
      const cell = i / CELL_BYTES;
      const x = cell % w;
      const y = Math.floor(cell / w);
      const dec = (b: Uint8Array) => {
        const dv = new DataView(b.buffer, b.byteOffset + i, CELL_BYTES);
        return `ch=${dv.getUint32(0, true)} fg=${dv.getUint32(4).toString(16)} bg=${dv
          .getUint32(8)
          .toString(16)} attr=${dv.getUint16(12, true)}`;
      };
      return `cell (${x},${y}): ffi[${dec(ffi)}] != js[${dec(js)}]`;
    }
  }
  return null;
}

function expectParity(render: () => unknown, w: number, hgt: number): void {
  const { ffi, js } = renderBoth(render, w, hgt);
  const diff = firstDiff(ffi, js, w);
  expect(diff).toBeNull();
}

describe("golden-frame parity (JS host == Rust paint)", () => {
  test("bordered + titled box", () => {
    expectParity(
      () => h("box", { border: true, title: "Hi", width: 14, height: 5, bg: 0x223344ff }),
      20,
      8,
    );
  });

  test("plain text auto-sized in a row", () => {
    expectParity(
      () =>
        h("box", { width: 40, height: 6, flexDirection: "row", alignItems: "flex-start" }, [
          h("text", {}, "hello world"),
        ]),
      40,
      6,
    );
  });

  test("multi-run styled text (spans fold fg + attrs)", () => {
    expectParity(
      () =>
        h("box", { width: 30, height: 4, flexDirection: "row", alignItems: "flex-start" }, [
          h("text", {}, [
            "a ",
            h("b", { fg: 0xff0000ff }, "bold"),
            " ",
            h("i", {}, "it"),
          ]),
        ]),
      30,
      4,
    );
  });

  test("wrapped text in a fixed width box", () => {
    expectParity(
      () =>
        h("box", { width: 40, height: 6, flexDirection: "row", alignItems: "flex-start" }, [
          h("text", { width: 8 }, "abcdefghijklmnop"),
        ]),
      40,
      6,
    );
  });

  test("wide CJK glyphs (pairing + continuation)", () => {
    expectParity(
      () =>
        h("box", { width: 20, height: 4, flexDirection: "row", alignItems: "flex-start" }, [
          h("text", {}, "世界abc"),
        ]),
      20,
      4,
    );
  });

  test("flush sibling boxes share an edge (rounding parity)", () => {
    expectParity(
      () =>
        h("box", { width: 21, height: 4, flexDirection: "row" }, [
          h("box", { flexGrow: 1, height: 4, bg: 0x550000ff }),
          h("box", { flexGrow: 1, height: 4, bg: 0x005500ff }),
          h("box", { flexGrow: 1, height: 4, bg: 0x000055ff }),
        ]),
      21,
      4,
    );
  });

  test("child clipped to parent content box (border + padding inset)", () => {
    expectParity(
      () =>
        h("box", { border: true, padding: 1, width: 12, height: 6 }, [
          h("box", { width: 20, height: 10, bg: 0x336699ff }),
        ]),
      16,
      8,
    );
  });

  test("nested boxes with backgrounds", () => {
    expectParity(
      () =>
        h("box", { width: 20, height: 6, bg: 0x111111ff, padding: 1 }, [
          h("box", { width: 8, height: 3, bg: 0xaa00aaff, border: true }),
        ]),
      20,
      6,
    );
  });

  test("transparent bordered box inherits the bg under it", () => {
    // The inner box sets a border but NO bg, so its border cells must read the
    // parent's bg (bg_under), not stamp a default — a paint.rs transparency path.
    expectParity(
      () =>
        h("box", { width: 16, height: 6, bg: 0x442211ff, padding: 1 }, [
          h("box", { border: true, width: 10, height: 4 }),
        ]),
      16,
      6,
    );
  });

  test("invisible / zero-opacity node is not drawn", () => {
    expectParity(
      () =>
        h("box", { width: 16, height: 4, bg: 0x222222ff }, [
          h("box", { width: 6, height: 2, bg: 0xff0000ff, visible: false }),
          h("box", { width: 6, height: 2, bg: 0x00ff00ff, opacity: 0 }),
        ]),
      16,
      4,
    );
  });

  test("unfocused input renders its value", () => {
    expectParity(
      () =>
        h("box", { width: 20, height: 3, flexDirection: "row", alignItems: "flex-start" }, [
          h("input", { value: "hello", width: 10 }),
        ]),
      20,
      3,
    );
  });
});
