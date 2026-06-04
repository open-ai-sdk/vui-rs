<template>
  <box
    :width="64"
    :height="18"
    flexDirection="column"
    :padding="{ left: 2, right: 2, top: 1, bottom: 1 }"
    :bg="BASE"
    border="rounded"
    :borderColor="BLUE"
    title=" mouse input "
    titleAlign="center"
    :onMouseMove="onRootMove"
    :onMouseUp="endDrag"
    :onWheel="onWheel"
  >
    <text :fg="TEXT"
      >target: <b :fg="GREEN">{{ activeTarget }}</b></text
    >
    <text :fg="SUBTLE"
      >pos: {{ pos.x }},{{ pos.y }} · moves: {{ moves }} · drags:
      {{ drags }} · wheel: {{ wheel }}</text
    >

    <box
      :width="{ pct: 1 }"
      :height="11"
      position="relative"
      :bg="SURFACE"
      border="single"
      :borderColor="SUBTLE"
      title=" click / drag / wheel here "
    >
      <box
        :width="30"
        :height="7"
        position="absolute"
        :left="blue.x"
        :top="blue.y"
        border="rounded"
        :borderColor="activeTarget === 'blue' ? GREEN : BLUE"
        :bg="activeTarget === 'blue' ? BLUE_ACTIVE : BLUE_DIM"
        focusable
        :onMouseDown="(ev) => beginDrag('blue', ev)"
        :onMouseUp="endDrag"
        :onMouseMove="onPanelMove"
        :onWheel="onWheel"
      >
        <text :fg="TEXT">blue panel</text>
        <text :fg="SUBTLE">click focuses this node</text>
      </box>

      <box
        :width="30"
        :height="7"
        position="absolute"
        :left="green.x"
        :top="green.y"
        border="rounded"
        :borderColor="activeTarget === 'green' ? BLUE : GREEN"
        :bg="activeTarget === 'green' ? GREEN_ACTIVE : GREEN_DIM"
        focusable
        :onMouseDown="onGreenDown"
        :onMouseUp="endDrag"
        :onMouseMove="onPanelMove"
        :onWheel="onWheel"
      >
        <text :fg="TEXT">green panel</text>
        <text :fg="SUBTLE">overlaps blue; topmost wins</text>
      </box>
    </box>

    <text :fg="SUBTLE">Ctrl-C to quit</text>
  </box>
</template>

<script setup lang="ts">
import { reactive, ref } from "@vui-rs/vue";
import type { DispatchableMouseEvent, MouseEvent } from "@vui-rs/vue";

const BASE = "#1e1e2e";
const SURFACE = "#313244";
const TEXT = "#cdd6f4";
const BLUE = "#89b4fa";
const GREEN = "#a6e3a1";
const SUBTLE = "#7f849c";
const BLUE_DIM = "#24314f";
const BLUE_ACTIVE = "#1f4f86";
const GREEN_DIM = "#244834";
const GREEN_ACTIVE = "#2f6f45";

const activeTarget = ref("none");
const moves = ref(0);
const drags = ref(0);
const wheel = ref(0);
const pos = reactive({ x: 0, y: 0 });
const blue = reactive({ x: 2, y: 1 });
const green = reactive({ x: 19, y: 4 });
const dragging = reactive({
  target: "" as "" | "blue" | "green",
  lastX: 0,
  lastY: 0,
});

function updatePos(ev: MouseEvent): void {
  pos.x = ev.x;
  pos.y = ev.y;
}

function select(target: string): void {
  activeTarget.value = target;
}

function beginDrag(target: "blue" | "green", ev: DispatchableMouseEvent): void {
  select(target);
  dragging.target = target;
  dragging.lastX = ev.x;
  dragging.lastY = ev.y;
  ev.preventDefault();
}

function endDrag(): void {
  dragging.target = "";
}

function onGreenDown(ev: DispatchableMouseEvent): void {
  beginDrag("green", ev);
}

function onRootMove(ev: MouseEvent): void {
  updatePos(ev);
  if (ev.kind === "move") moves.value += 1;
  if (ev.kind === "drag") drags.value += 1;
  applyDrag(ev);
}

function onPanelMove(ev: DispatchableMouseEvent): void {
  updatePos(ev);
  if (ev.kind === "move") moves.value += 1;
  if (ev.kind === "drag") drags.value += 1;
  applyDrag(ev);
  ev.preventDefault();
}

function applyDrag(ev: MouseEvent): void {
  if (ev.kind !== "drag" || !dragging.target) return;
  const target = dragging.target === "blue" ? blue : green;
  target.x = clamp(target.x + ev.x - dragging.lastX, 0, 28);
  target.y = clamp(target.y + ev.y - dragging.lastY, 0, 4);
  dragging.lastX = ev.x;
  dragging.lastY = ev.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function onWheel(ev: DispatchableMouseEvent): void {
  updatePos(ev);
  wheel.value += ev.button === "wheelDown" ? -1 : 1;
  ev.preventDefault();
}
</script>
