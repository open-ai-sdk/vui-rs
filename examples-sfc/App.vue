<!-- The canonical SFC showcase: composes two child `.vue` components (Counter,
     Form), proving `.vue`-imports-`.vue`, reactive state, v-for, v-if, and the
     `<input v-model>` contract — all built by `vite build` into one bundle that
     Bun runs. `bun run dev:sfc`. -->
<template>
  <box flexDirection="column" :gap="1" :padding="1">
    <Counter />
    <Form />
  </box>
</template>

<script setup lang="ts">
import Counter from "./counter.vue";
import Form from "./form.vue";
</script>
