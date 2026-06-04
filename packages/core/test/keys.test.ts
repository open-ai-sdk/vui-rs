// Byte-chunk → key-event parser coverage: the common terminal key set, modifier
// decoding, alt/ctrl, and bracketed paste (captured literally, never re-parsed).
import { describe, expect, test } from "bun:test";
import { createKeyDecoder, Key, matchesKey, parseKeys, type KeyEvent, type MouseEvent } from "../src/keys.ts";

/** Parse a chunk expected to yield exactly one event and return it. */
function one(data: string) {
  const evs = parseKeys(data);
  expect(evs.length).toBe(1);
  return evs[0]!;
}

describe("key parser", () => {
  test("printable chars become one key event each", () => {
    const evs = parseKeys("aB") as KeyEvent[];
    expect(evs.map((e) => e.name)).toEqual(["a", "B"]);
    expect(evs[0]!.shift).toBe(false);
    expect(evs[1]!.shift).toBe(true); // uppercase reports shift
  });

  test("named control keys", () => {
    expect(one("\r")).toMatchObject({ name: "enter" });
    expect(one("\n")).toMatchObject({ name: "enter" });
    expect(one("\t")).toMatchObject({ name: "tab", shift: false });
    expect(one("\x7f")).toMatchObject({ name: "backspace" });
    expect(one("\x1b[Z")).toMatchObject({ name: "tab", shift: true });
  });

  test("ctrl-letter and ctrl-space", () => {
    expect(one("\x03")).toMatchObject({ name: "c", ctrl: true });
    expect(one("\x00")).toMatchObject({ name: "space", ctrl: true });
  });

  test("arrows, home/end, delete via CSI", () => {
    expect(one("\x1b[A")).toMatchObject({ name: "up" });
    expect(one("\x1b[D")).toMatchObject({ name: "left" });
    expect(one("\x1b[H")).toMatchObject({ name: "home" });
    expect(one("\x1b[F")).toMatchObject({ name: "end" });
    expect(one("\x1b[3~")).toMatchObject({ name: "delete" });
  });

  test("CSI modifier params decode", () => {
    expect(one("\x1b[1;5C")).toMatchObject({ name: "right", ctrl: true });
    expect(one("\x1b[1;2A")).toMatchObject({ name: "up", shift: true });
    expect(one("\x1b[1;3D")).toMatchObject({ name: "left", alt: true });
  });

  test("SS3 function keys", () => {
    expect(one("\x1bOP")).toMatchObject({ name: "f1" });
    expect(one("\x1bOB")).toMatchObject({ name: "down" });
  });

  test("alt-letter and lone escape", () => {
    expect(one("\x1bb")).toMatchObject({ name: "b", alt: true });
    expect(one("\x1b")).toMatchObject({ name: "escape" });
  });

  test("bracketed paste is captured literally, not re-parsed", () => {
    const ev = one("\x1b[200~hello world\x1b[201~");
    expect(ev).toEqual({ type: "paste", text: "hello world" });
    // An escape sequence inside a paste must survive as text, never as keys.
    const inj = one("\x1b[200~\x1b[2J\x1b[201~");
    expect(inj).toEqual({ type: "paste", text: "\x1b[2J" });
  });

  test("a multi-key chunk splits into ordered events", () => {
    const evs = parseKeys("hi\r") as KeyEvent[];
    expect(evs.map((e) => e.name)).toEqual(["h", "i", "enter"]);
  });

  test("decoder buffers a sequence split across chunks", () => {
    const d = createKeyDecoder();
    // A CSI arrow arriving in two reads must not mis-parse as ESC + "[C".
    expect(d.feed("\x1b[")).toEqual([]);
    const evs = d.feed("C") as KeyEvent[];
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ name: "right" });
  });

  test("decoder buffers a CSI sequence split after ESC", () => {
    const d = createKeyDecoder();
    // Some terminals deliver ESC as its own read before the rest of the CSI.
    expect(d.feed("\x1b")).toEqual([]);
    const evs = d.feed("[C") as KeyEvent[];
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ name: "right" });
  });

  test("decoder buffers a bracketed paste split across chunks", () => {
    const d = createKeyDecoder();
    expect(d.feed("\x1b[200~hel")).toEqual([]);
    expect(d.feed("lo wor")).toEqual([]);
    const evs = d.feed("ld\x1b[201~");
    expect(evs).toEqual([{ type: "paste", text: "hello world" }]);
  });

  test("decoder emits complete events and holds only the partial tail", () => {
    const d = createKeyDecoder();
    const evs = d.feed("ab\x1b[") as KeyEvent[]; // "a","b" now; CSI tail buffered
    expect(evs.map((e) => e.name)).toEqual(["a", "b"]);
    expect((d.feed("A") as KeyEvent[])[0]).toMatchObject({ name: "up" });
  });

  test("matchesKey matches name + modifiers", () => {
    expect(matchesKey(one("\x03"), Key.ctrl("c"))).toBe(true);
    expect(matchesKey(one("\x03"), "c")).toBe(false); // ctrl required
    expect(matchesKey(one("\x1b[Z"), "shift+tab")).toBe(true);
    expect(matchesKey(one("\r"), Key.enter)).toBe(true);
    expect(matchesKey({ type: "paste", text: "x" }, "a")).toBe(false);
  });

  test("SGR mouse parses 0-indexed coordinates and modifiers", () => {
    const ev = one("\x1b[<20;5;3M") as MouseEvent;
    expect(ev).toMatchObject({
      type: "mouse",
      kind: "down",
      button: "left",
      x: 4,
      y: 2,
      shift: true,
      ctrl: true,
      alt: false,
    });
  });

  test("SGR mouse tracks drag and release across decoder chunks", () => {
    const d = createKeyDecoder();
    expect(d.feed("\x1b[<0;2;2M")[0]).toMatchObject({ type: "mouse", kind: "down", button: "left" });
    expect(d.feed("\x1b[<32;3;2M")[0]).toMatchObject({ type: "mouse", kind: "drag", button: "left", x: 2, y: 1 });
    expect(d.feed("\x1b[<0;3;2m")[0]).toMatchObject({ type: "mouse", kind: "up", button: "left", x: 2, y: 1 });
  });

  test("SGR wheel emits wheel direction", () => {
    expect(one("\x1b[<64;1;1M")).toMatchObject({ type: "mouse", kind: "wheel", button: "wheelUp", x: 0, y: 0 });
    expect(one("\x1b[<65;1;1M")).toMatchObject({ type: "mouse", kind: "wheel", button: "wheelDown", x: 0, y: 0 });
  });

  test("X10 mouse fallback parses button events", () => {
    const seq = "\x1b[M" + String.fromCharCode(32) + String.fromCharCode(37) + String.fromCharCode(35);
    expect(one(seq)).toMatchObject({ type: "mouse", kind: "down", button: "left", x: 4, y: 2 });
  });
});
