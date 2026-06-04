// Custom `v-model` directive transform for the vui-rs SFC compiler.
//
// Vue's DOM build compiles `v-model` on a native `<input>` into the
// `vModelText` runtime directive (which pokes `el.value` + a DOM `input`
// listener) — meaningless for a terminal. We bypass that. Instead we reuse
// compiler-core's platform-agnostic `transformModel` (which correctly handles
// `<script setup>` ref-unwrapping, so `v-model="count"` on a ref emits
// `count.value = $event`), then rename the emitted props from Vue's component
// convention (`modelValue` / `onUpdate:modelValue`) to vui's input contract
// (`value` / `onUpdate:value`) that `VuiInput` declares. No runtime directive.
import {
  type DirectiveTransform,
  NodeTypes,
  transformModel as baseTransformModel,
} from "@vue/compiler-core";

/** Tags `v-model` is valid on — the editable widget(s). */
const MODELABLE_TAGS = new Set(["input", "textarea"]);

export const vuiModelTransform: DirectiveTransform = (dir, node, context) => {
  if (!MODELABLE_TAGS.has(node.tag)) {
    const err = new SyntaxError(
      `vui: v-model is only supported on <input> and <textarea>; got <${node.tag}>`,
    ) as SyntaxError & { code: number; loc: typeof dir.loc };
    err.code = -1;
    err.loc = dir.loc;
    context.onError(err);
    return { props: [] };
  }

  // Base transform yields `[modelValue: <exp>, "onUpdate:modelValue": <assign>]`
  // (+ `modelModifiers` for components, which `VuiInput` ignores). Rename the
  // two model keys in place; everything else (the assignment, ref-unwrapping,
  // handler caching) is exactly what we want.
  const result = baseTransformModel(dir, node, context);
  for (const prop of result.props) {
    if (prop.key.type !== NodeTypes.SIMPLE_EXPRESSION) continue;
    if (prop.key.content === "modelValue") prop.key.content = "value";
    else if (prop.key.content === "onUpdate:modelValue") prop.key.content = "onUpdate:value";
  }
  return result;
};
