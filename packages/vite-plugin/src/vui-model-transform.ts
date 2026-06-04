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

/** Editable tags use vui's `value`/`update:value` contract. */
const VALUE_MODEL_TAGS = new Set(["input", "textarea"]);
/** Component widgets keep Vue's standard `modelValue`/`update:modelValue`. */
const MODEL_VALUE_TAGS = new Set(["scroll-box", "scroll-bar", "select-list"]);

export const vuiModelTransform: DirectiveTransform = (dir, node, context) => {
  if (!VALUE_MODEL_TAGS.has(node.tag) && !MODEL_VALUE_TAGS.has(node.tag)) {
    const err = new SyntaxError(
      `vui: v-model is only supported on <input>, <textarea>, <scroll-box>, <scroll-bar>, and <select-list>; got <${node.tag}>`,
    ) as SyntaxError & { code: number; loc: typeof dir.loc };
    err.code = -1;
    err.loc = dir.loc;
    context.onError(err);
    return { props: [] };
  }

  const result = baseTransformModel(dir, node, context);
  if (!VALUE_MODEL_TAGS.has(node.tag)) return result;
  // Base transform yields `[modelValue: <exp>, "onUpdate:modelValue": <assign>]`.
  // Rename edit widgets to vui's input/textarea contract; component widgets keep
  // the standard Vue model keys.
  for (const prop of result.props) {
    if (prop.key.type !== NodeTypes.SIMPLE_EXPRESSION) continue;
    if (prop.key.content === "modelValue") prop.key.content = "value";
    else if (prop.key.content === "onUpdate:modelValue") prop.key.content = "onUpdate:value";
  }
  return result;
};
