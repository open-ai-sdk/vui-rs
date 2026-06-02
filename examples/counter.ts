#!/usr/bin/env bun
// Reactive counter driven entirely by Vue. A `ref` ticks once a second; each
// change repaints the bordered box through the Rust core. This proves the Phase
// 03 keystone end-to-end: Vue reactivity → custom renderer → FFI → cell diff.
//
// The scheduler coalesces a whole reactive batch into ONE native render per
// frame, so `ticks` and `renders` printed on exit track closely (one render per
// tick). Press Ctrl-C to exit — the terminal (alt screen + cursor) is restored.
import { createApp, defineComponent, h, onMounted, onUnmounted, ref } from "@vui-rs/vue";

// Catppuccin Mocha-ish palette.
const BASE = "#1e1e2e";
const TEXT = "#cdd6f4";
const GREEN = "#a6e3a1";
const BLUE = "#89b4fa";
const SUBTLE = "#7f849c";

let ticks = 0;

const Counter = defineComponent({
  setup() {
    const count = ref(0);
    let timer: ReturnType<typeof setInterval> | undefined;
    onMounted(() => {
      timer = setInterval(() => {
        count.value++;
        ticks++;
      }, 1000);
    });
    onUnmounted(() => clearInterval(timer));

    return () =>
      h(
        "box",
        {
          width: 34,
          height: 5,
          flexDirection: "column",
          justifyContent: "center",
          padding: { left: 2, right: 2, top: 0, bottom: 0 },
          bg: BASE,
          border: "rounded",
          borderColor: BLUE,
          title: " vui counter ",
          titleAlign: "center",
        },
        [
          // Text nodes have no intrinsic size yet — give each a width + one line
          // of height so taffy reserves space for it (otherwise it collapses to 0).
          h(
            "text",
            { width: { pct: 1 }, height: 1, fg: TEXT },
            ["count: ", h("b", { fg: GREEN }, String(count.value))],
          ),
          h("text", { width: { pct: 1 }, height: 1, fg: SUBTLE }, "press Ctrl-C to exit"),
        ],
      );
  },
});

const app = createApp(Counter).mount();

// After the alt screen is restored on exit, report the coalescing ratio.
process.once("exit", () => {
  process.stdout.write(`\nticks=${ticks} renders=${app.context.renderCount}\n`);
});
