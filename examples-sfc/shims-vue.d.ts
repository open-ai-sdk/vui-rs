// Let TypeScript resolve `.vue` imports. The Vite plugin compiles each SFC into
// a Vue component object at build time; for type-checking we only need to know
// the default export is a component. (vui-rs uses no template type-checking via
// vue-tsc yet — this keeps `tsc --noEmit` happy on `import App from "./App.vue"`.)
declare module "*.vue" {
  import type { DefineComponent } from "@vue/runtime-core";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
