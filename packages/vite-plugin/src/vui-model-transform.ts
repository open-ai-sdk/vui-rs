// Custom `v-model` directive transform for the vui-rs SFC compiler.
//
// Vue's DOM build compiles `v-model` on a native `<input>` into the
// `vModelText` runtime directive (which pokes `el.value` + a DOM `input`
// listener) — meaningless for a terminal. We bypass that. Instead we reuse
// compiler-core's platform-agnostic `transformModel` (which correctly handles
// `<script setup>` ref-unwrapping, so `v-model="count"` on a ref emits
// `count.value = $event`), then for the editable `<input>`/`<textarea>` widgets
// rename the emitted props from Vue's component convention (`modelValue` /
// `onUpdate:modelValue`) to vui's input contract (`value` / `onUpdate:value`)
// that `VuiInput` declares.
//
// Everything that compiles as a *component* (the runtime widgets `<scroll-box>`/
// `<select-list>`/… AND any app component like a `<VuiDialog>`) keeps Vue's
// standard model convention untouched — so `v-model:open` on a custom dialog
// round-trips through its `open`/`update:open` props as usual. Only vui *elements*
// (`<box>`, `<text>`, `<overlay>`, …) reject `v-model`: they have no value to bind.
import {
  type DirectiveTransform,
  ElementTypes,
  NodeTypes,
  transformModel as baseTransformModel,
} from "@vue/compiler-core";

/** Editable tags use vui's `value`/`update:value` contract. */
const VALUE_MODEL_TAGS = new Set(["input", "textarea"]);

export const vuiModelTransform: DirectiveTransform = (dir, node, context) => {
  // A vui element (box/text/span/overlay/canvas/image) has nothing to two-way
  // bind; only components do. `isCustomElement` marks vui elements as ELEMENT.
  if (node.tagType === ElementTypes.ELEMENT) {
    const err = new SyntaxError(
      `vui: v-model is not supported on the <${node.tag}> element (only on <input>/<textarea> and components)`,
    ) as SyntaxError & { code: number; loc: typeof dir.loc };
    err.code = -1;
    err.loc = dir.loc;
    context.onError(err);
    return { props: [] };
  }

  const result = baseTransformModel(dir, node, context);
  // Components (runtime widgets + app components) keep the standard model keys.
  if (!VALUE_MODEL_TAGS.has(node.tag)) return result;
  // Base transform yields `[modelValue: <exp>, "onUpdate:modelValue": <assign>]`
  // for the default (unnamed) model; rename to vui's input/textarea contract.
  for (const prop of result.props) {
    if (prop.key.type !== NodeTypes.SIMPLE_EXPRESSION) continue;
    if (prop.key.content === "modelValue") prop.key.content = "value";
    else if (prop.key.content === "onUpdate:modelValue") prop.key.content = "onUpdate:value";
  }
  return result;
};
