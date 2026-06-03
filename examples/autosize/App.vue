<!-- Auto-size text: every <text> sizes itself to its content via taffy's measure
     callback — none set an explicit width/height. Shows boxes that hug their
     label, wrap vs nowrap at the same width, and auto height from wrapped + \n. -->
<template>
  <box flexDirection="column" :padding="1" :gap="1" alignItems="flex-start" :bg="BASE">
    <text :fg="ACCENT">auto-size text — no &lt;text&gt; below sets width/height</text>

    <text :fg="SUBTLE">A. boxes hug their text:</text>
    <box flexDirection="row" :gap="2" alignItems="flex-start">
      <box border="rounded" :borderColor="GREEN" :bg="SURFACE" :padding="{ left: 1, right: 1 }">
        <text :fg="GREEN">OK</text>
      </box>
      <box border="rounded" :borderColor="PINK" :bg="SURFACE" :padding="{ left: 1, right: 1 }">
        <text :fg="PINK">Cancel</text>
      </box>
      <box border="rounded" :borderColor="ACCENT" :bg="SURFACE" :padding="{ left: 1, right: 1 }">
        <text :fg="ACCENT">✦ Save 你好 ✦</text>
      </box>
    </box>

    <text :fg="SUBTLE">B. wrap (default) vs nowrap — same width 20:</text>
    <box flexDirection="row" :gap="2" alignItems="flex-start">
      <box :width="20" border="single" :borderColor="GREEN" :bg="SURFACE" :padding="1" title=" wrap " titleAlign="left">
        <text :fg="TEXT">{{ SENTENCE }}</text>
      </box>
      <box :width="20" border="single" :borderColor="PINK" :bg="SURFACE" :padding="1" title=" nowrap " titleAlign="left">
        <text :fg="TEXT" wrap="nowrap">{{ SENTENCE }}</text>
      </box>
    </box>

    <text :fg="SUBTLE">C. auto height (wrap + \n):</text>
    <box :width="28" border="single" :borderColor="ACCENT" :bg="SURFACE" :padding="1" title=" notes " titleAlign="left">
      <text :fg="TEXT">{{ NOTES }}</text>
    </box>

    <text :fg="SUBTLE">Ctrl-C to quit</text>
  </box>
</template>

<script setup lang="ts">
const BASE = "#1e1e2e";
const SURFACE = "#313244";
const ACCENT = "#89b4fa";
const GREEN = "#a6e3a1";
const PINK = "#f5c2e7";
const TEXT = "#cdd6f4";
const SUBTLE = "#7f849c";

const SENTENCE = "the quick brown fox jumps over the lazy dog";
const NOTES = "first line\nthis second line is long enough to wrap onto more rows\nlast";
</script>
