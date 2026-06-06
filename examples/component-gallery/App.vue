<template>
  <!-- The root holds focus (reliable); it opens dialogs on letter keys and scrolls
       the virtual list on ↑/↓/PageUp/PageDown/Home/End (forwarded via :scrollY). -->
  <box :width="{ pct: 1 }" :height="{ pct: 1 }" flexDirection="column" :bg="theme.background" :fg="theme.text"
       :focusable="true" :focused="!anyModal" @keyDown="onMenuKey">
    <!-- Header: title + a live working indicator -->
    <VuiHeader>
      <template #left>
        <text :fg="theme.primary" bold>vui-rs · component gallery</text>
      </template>
      <template #right>
        <VuiWorkingIndicator :done="!busy" :label="'Working…'" doneLabel="Idle" />
      </template>
    </VuiHeader>

    <!-- Body -->
    <box :flexGrow="1" flexDirection="row" :gap="2" :padding="{ left: 2, right: 2, top: 1, bottom: 1 }">
      <!-- Left: menu + spinner variants + autocomplete -->
      <box flexDirection="column" :gap="0" :width="40">
        <text :fg="theme.textMuted">Open a component:</text>
        <text><b :fg="theme.success">c</b> confirm · <b :fg="theme.success">a</b> alert · <b :fg="theme.success">p</b> prompt</text>
        <text><b :fg="theme.success">s</b> fuzzy select · <b :fg="theme.success">k</b> command palette</text>
        <text><b :fg="theme.success">t</b> toast · <b :fg="theme.success">w</b> toggle working</text>
        <text> </text>
        <text :fg="theme.textMuted">Spinner variants:</text>
        <box flexDirection="row" :gap="2">
          <VuiSpinner preset="braille" label="braille" />
          <VuiSpinner preset="arc" label="arc" />
          <VuiSpinner preset="circle" label="circle" />
        </box>
        <box flexDirection="row" :gap="2">
          <VuiSpinner preset="arrow" label="arrow" />
          <VuiSpinner preset="bounce" label="bounce" />
          <VuiSpinner preset="pulse" label="pulse" />
        </box>
        <text> </text>
        <text :fg="theme.textMuted">Autocomplete (Tab here, type “@” or “/”):</text>
        <box flexDirection="column" @keyDown="ac.onKeyDown">
          <box border="rounded" :borderColor="theme.border" :padding="{ left: 1, right: 1 }">
            <VuiInput :value="acQuery" placeholder="Mention someone…" :focused="false"
                      :cursorColor="theme.primary" @update:value="(v: string) => (acQuery = v)"
                      @enter="onAcEnter" />
          </box>
          <VuiAutocomplete :suggestions="ac.suggestions.value" :active="ac.active.value"
                           @select="(s: Suggestion) => acceptSuggestion(s)" />
        </box>
      </box>

      <!-- Right: a 10k-row virtual list (focused by default; ↑/↓/PageUp/PageDown scroll) -->
      <box :flexGrow="1" flexDirection="column">
        <text :fg="theme.textMuted">Virtual list · 10,000 rows (↑/↓ · PageUp/PageDown · wheel · drag the bar):</text>
        <box flexDirection="column" border="rounded" :borderColor="theme.border" :padding="{ left: 1, right: 1 }">
          <VuiVirtualList :items="rows" :height="listHeight" :scrollbar="true"
                          :scrollY="listScrollY" @update:scrollY="(y: number) => (listScrollY = y)">
            <template #default="{ item, index }">
              <text :fg="index % 2 ? theme.text : theme.textMuted">{{ index }} · {{ item }}</text>
            </template>
          </VuiVirtualList>
        </box>
      </box>
    </box>

    <!-- Footer -->
    <VuiFooter>
      <template #left><text :fg="theme.textMuted">Tab to move focus</text></template>
      <template #right><text :fg="theme.textMuted">q / Ctrl-C to quit</text></template>
    </VuiFooter>

    <!-- Modals -->
    <VuiDialogConfirm v-model:open="confirmOpen" title="Confirm" message="Ship this build to production?"
                      @confirm="(v: boolean) => toast.show(v ? 'Shipped 🚀' : 'Cancelled', { kind: v ? 'success' : 'warning' })" />
    <VuiDialogAlert v-model:open="alertOpen" title="Heads up" message="This is an alert dialog. Press Enter to dismiss." />
    <VuiDialogPrompt v-model:open="promptOpen" title="Rename" message="New file name:" placeholder="file.ts"
                     :validate="validateName" @submit="(v: string) => toast.show('Renamed to ' + v, { kind: 'success' })" />
    <VuiDialogSelect v-model:open="selectOpen" title="Open file" :items="files"
                     @select="(v: string) => toast.show('Opened ' + v, { kind: 'info' })" />
    <VuiCommandPalette v-model:open="paletteOpen" :commands="commands" />

    <!-- Toasts -->
    <VuiToastHost position="top-right" />
  </box>
</template>

<script setup lang="ts">
import { ref } from "@vui-rs/vue";
import { useTheme, VuiInput, VuiSpinner } from "@vui-rs/vue";
import type { DispatchableEvent } from "@vui-rs/vue";
import {
  VuiHeader, VuiFooter,
  VuiDialogConfirm, VuiDialogAlert, VuiDialogPrompt, VuiDialogSelect,
  VuiCommandPalette, VuiToastHost, VuiVirtualList, VuiWorkingIndicator, VuiAutocomplete,
  provideToasts, useAutocomplete,
  type Command, type Suggestion,
} from "@vui-rs/ui";
import { computed } from "@vui-rs/vue";

const theme = useTheme();
const toast = provideToasts();

const busy = ref(true);
const confirmOpen = ref(false);
const alertOpen = ref(false);
const promptOpen = ref(false);
const selectOpen = ref(false);
const paletteOpen = ref(false);
const anyModal = computed(() => confirmOpen.value || alertOpen.value || promptOpen.value || selectOpen.value || paletteOpen.value);

const rows = Array.from({ length: 10000 }, (_, i) => `row item #${i} — lorem ipsum dolor sit`);
// Virtual-list viewport height: terminal rows minus the header/footer/border chrome.
const listHeight = Math.max(3, (process.stdout.rows ?? 24) - 8);
// Controlled scroll offset for the list (the root owns focus + the keyboard).
const listScrollY = ref(0);
const listMaxScroll = () => Math.max(0, rows.length - listHeight);
function scrollList(delta: number): void {
  listScrollY.value = Math.max(0, Math.min(listMaxScroll(), listScrollY.value + delta));
}

const files = [
  { label: "src/index.ts", value: "src/index.ts", group: "Source", hint: "ts" },
  { label: "src/app.ts", value: "src/app.ts", group: "Source", hint: "ts" },
  { label: "src/theme.ts", value: "src/theme.ts", group: "Source", hint: "ts" },
  { label: "README.md", value: "README.md", group: "Docs", hint: "md" },
  { label: "package.json", value: "package.json", group: "Config", hint: "json" },
  { label: "tsconfig.json", value: "tsconfig.json", group: "Config", hint: "json" },
];

const commands: Command[] = [
  { id: "build", title: "Build project", hint: "⌘B", group: "Tasks", run: () => toast.show("Building…") },
  { id: "test", title: "Run tests", hint: "⌘T", group: "Tasks", run: () => toast.show("Testing…") },
  { id: "theme", title: "Toggle theme", hint: "⌘K T", group: "View", run: () => toast.show("Theme toggled") },
  { id: "quit", title: "Quit", hint: "⌃C", group: "App", run: () => process.exit(0) },
];

function validateName(v: string): string | null {
  if (v.trim().length === 0) return "Name cannot be empty";
  if (!/\.[a-z]+$/.test(v)) return "Include a file extension";
  return null;
}

// Autocomplete: an "@mention" + "/command" provider stack.
const acQuery = ref("");
const PEOPLE = ["alice", "bob", "carol", "dave"];
const SLASH = ["help", "clear", "reset"];
const ac = useAutocomplete({
  query: () => acQuery.value,
  providers: [
    (q) => (q.startsWith("@") ? PEOPLE.filter((p) => p.startsWith(q.slice(1))).map((p) => ({ label: "@" + p, value: p })) : []),
    (q) => (q.startsWith("/") ? SLASH.filter((s) => s.startsWith(q.slice(1))).map((s) => ({ label: "/" + s, value: s, hint: "cmd" })) : []),
  ],
  onAccept: (s: Suggestion) => { acQuery.value = ""; toast.show("Picked " + s.value); },
});
function acceptSuggestion(s: Suggestion): void {
  acQuery.value = "";
  toast.show("Picked " + s.value);
}
// The input consumes Enter, so accept the active suggestion from its @enter.
function onAcEnter(): void {
  if (ac.visible.value) ac.accept();
}

function onMenuKey(ev: DispatchableEvent): void {
  if (ev.type !== "key" || anyModal.value) return; // a modal owns the keyboard while open
  // Scroll the virtual list (the root owns focus, so it drives the list).
  const page = Math.max(1, listHeight - 1);
  const scroll: Record<string, number> = {
    up: -1, down: 1, pageUp: -page, pageDown: page,
    home: -listScrollY.value, end: listMaxScroll() - listScrollY.value,
  };
  if (ev.name in scroll) {
    ev.preventDefault();
    scrollList(scroll[ev.name]!);
    return;
  }
  const map: Record<string, () => void> = {
    c: () => (confirmOpen.value = true),
    a: () => (alertOpen.value = true),
    p: () => (promptOpen.value = true),
    s: () => (selectOpen.value = true),
    k: () => (paletteOpen.value = true),
    t: () => toast.show("Hello from a toast!", { kind: "info" }),
    w: () => (busy.value = !busy.value),
    q: () => process.exit(0),
  };
  const action = map[ev.name];
  if (action) {
    ev.preventDefault();
    action();
  }
}
</script>
