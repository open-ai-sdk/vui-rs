import { describe, expect, test } from "bun:test";
import { defineComponent, h, ref } from "@vue/runtime-core";
import { type AutocompleteApi, useAutocomplete } from "../src/autocomplete.ts";
import { type Suggestion } from "../src/autocomplete.ts";
import { key, mount } from "./helpers.ts";

function mountAutocomplete() {
  const query = ref("");
  const accepted: Suggestion[] = [];
  let api!: AutocompleteApi;
  const Root = defineComponent({
    setup() {
      api = useAutocomplete({
        query: () => query.value,
        providers: [
          (q) => (q.startsWith("@") ? [{ label: "@alice", value: "alice" }, { label: "@bob", value: "bob" }] : []),
          (q) => (q.startsWith("/") ? [{ label: "/help", value: "help" }] : []),
        ],
        onAccept: (s) => accepted.push(s),
      });
      return () => h("box", {});
    },
  });
  const harness = mount(40, 8, () => h(Root));
  return { ...harness, query, accepted, get api() { return api; } };
}

describe("useAutocomplete", () => {
  test("runs the provider stack against the query", () => {
    const { api, query, cleanup } = mountAutocomplete();
    expect(api.suggestions.value.length).toBe(0);
    query.value = "@";
    expect(api.suggestions.value.map((s) => s.value)).toEqual(["alice", "bob"]);
    expect(api.visible.value).toBe(true);
    cleanup();
  });

  test("Down moves the active suggestion; accept() takes it", () => {
    const { api, query, accepted, cleanup } = mountAutocomplete();
    query.value = "@";
    api.onKeyDown(key("down"));
    expect(api.active.value).toBe(1);
    api.accept(); // wired to the input's @enter (Enter never reaches onKeyDown)
    expect(accepted.map((s) => s.value)).toEqual(["bob"]);
    cleanup();
  });

  test("accept() with no move takes the first suggestion", () => {
    const { api, query, accepted, cleanup } = mountAutocomplete();
    query.value = "/";
    api.accept();
    expect(accepted.map((s) => s.value)).toEqual(["help"]);
    cleanup();
  });

  test("onKeyDown ignores nav keys when there are no suggestions", () => {
    const { api, accepted, cleanup } = mountAutocomplete();
    api.onKeyDown(key("down"));
    expect(api.active.value).toBe(0);
    expect(accepted).toEqual([]);
    cleanup();
  });
});
