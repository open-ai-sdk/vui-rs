#!/usr/bin/env bun
// Interactive form: two native inputs, Tab to move focus, Enter to submit. This
// proves Phase 04 end-to-end — raw stdin → key parser → focus manager → focused
// <input>'s edit buffer (in Rust) → repaint — and that the terminal is always
// restored (Ctrl-C, normal exit, or a thrown error all run the same teardown).
import { createApp, defineComponent, h, ref, VuiInput } from "@vui-rs/vue";

// Catppuccin Mocha-ish palette.
const BASE = "#1e1e2e";
const SURFACE = "#313244";
const TEXT = "#cdd6f4";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const SUBTLE = "#7f849c";

let submitted: { name: string; email: string } | null = null;

const Form = defineComponent({
  setup() {
    const name = ref("");
    const email = ref("");

    function submit(): void {
      submitted = { name: name.value, email: email.value };
      app.unmount();
      process.exit(0);
    }

    const field = (
      label: string,
      model: { value: string },
      placeholder: string,
      focused: boolean,
    ) => [
      h("text", { width: { pct: 1 }, height: 1, fg: SUBTLE }, label),
      h(VuiInput, {
        width: { pct: 1 },
        height: 3,
        border: "rounded",
        borderColor: BLUE,
        bg: SURFACE,
        fg: TEXT,
        cursorColor: GREEN,
        placeholder,
        placeholderColor: SUBTLE,
        focused,
        value: model.value,
        "onUpdate:value": (v: string) => {
          model.value = v;
        },
        onEnter: submit,
      }),
    ];

    return () =>
      h(
        "box",
        {
          width: 48,
          flexDirection: "column",
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          bg: BASE,
          border: "rounded",
          borderColor: BLUE,
          title: " sign up ",
          titleAlign: "center",
        },
        [
          ...field("Name", name, "your name", true),
          ...field("Email", email, "you@example.com", false),
          h(
            "text",
            { width: { pct: 1 }, height: 1, fg: SUBTLE },
            "Tab to switch · Enter to submit · Ctrl-C to quit",
          ),
        ],
      );
  },
});

const app = createApp(Form).mount();

// The terminal is restored before this runs; report what was captured (if any).
process.once("exit", () => {
  if (submitted) {
    process.stdout.write(`\nsubmitted: name=${submitted.name} email=${submitted.email}\n`);
  }
});
