// Shared `.vue` import shim for all example workspaces. The Vite plugin compiles
// each SFC to a Vue component object at build time; for type-checking we only
// need the default export to be a component.
declare module '*.vue' {
  import type { DefineComponent } from '@vue/runtime-core'
  const component: DefineComponent<{}, {}, any>
  export default component
}
