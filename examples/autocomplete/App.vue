<template>
  <box :width="{ pct: 1 }" :height="{ pct: 1 }" flexDirection="column"
       :padding="{ left: 2, right: 2, top: 1, bottom: 1 }" :bg="theme.background" :fg="theme.text">
    <text :fg="theme.primary" bold>vui-rs · autocomplete</text>
    <text :fg="theme.textMuted">A provider stack suggests as you type; Up/Down to move, Enter to accept.</text>
    <text> </text>
    <text :fg="theme.textMuted">Try typing <b :fg="theme.success">@</b> (people) or <b :fg="theme.success">/</b> (commands):</text>
    <text> </text>

    <!-- The input owns focus; the wrapper forwards Up/Down to the autocomplete, and
         the input's @enter accepts the active suggestion. The popup sits in normal
         flow just below, so it never gets overpainted by the content under it. -->
    <box flexDirection="column" @keyDown="ac.onKeyDown">
      <box border="rounded" :borderColor="theme.border" :padding="{ left: 1, right: 1 }">
        <VuiInput :value="query" placeholder="Type @ or / …" :focused="true" :cursorColor="theme.primary"
                  @update:value="(v: string) => (query = v)" @enter="onEnter" />
      </box>
      <VuiAutocomplete :suggestions="ac.suggestions.value" :active="ac.active.value"
                       @select="(s: Suggestion) => accept(s)" />
    </box>

    <text> </text>
    <text :fg="theme.textMuted">Accepted: <b :fg="theme.info">{{ accepted.join(", ") || "—" }}</b></text>
    <text> </text>
    <text :fg="theme.textMuted">Ctrl-C to quit</text>
  </box>
</template>

<script setup lang="ts">
import { ref, useTheme, VuiInput } from "@vui-rs/vue";
import { VuiAutocomplete, useAutocomplete, type Suggestion } from "@vui-rs/ui";

const theme = useTheme();
const query = ref("");
const accepted = ref<string[]>([]);

const PEOPLE = ["alice", "bob", "carol", "dave", "erin"];
const COMMANDS = ["help", "clear", "reset", "reload", "quit"];

const ac = useAutocomplete({
  query: () => query.value,
  providers: [
    (q) =>
      q.startsWith("@")
        ? PEOPLE.filter((p) => p.startsWith(q.slice(1))).map((p) => ({ label: "@" + p, value: p, hint: "user" }))
        : [],
    (q) =>
      q.startsWith("/")
        ? COMMANDS.filter((c) => c.startsWith(q.slice(1))).map((c) => ({ label: "/" + c, value: c, hint: "cmd" }))
        : [],
  ],
  onAccept: accept,
});

function accept(s: Suggestion): void {
  accepted.value.push(s.value);
  query.value = "";
}

// The input consumes Enter (it never reaches ac.onKeyDown), so accept here.
function onEnter(): void {
  if (ac.visible.value) ac.accept();
}
</script>
