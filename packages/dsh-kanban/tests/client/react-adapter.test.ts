/**
 * T024 — the React adapter, characterized with a fake createElement that records
 * calls: one call per node, attributes passed through, text only as string
 * children, and never a dangerouslySetInnerHTML anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { el, txt } from "../../src/shared/tree.ts";
import { toReact } from "../../src/client/react-adapter.ts";

type Call = { tag: string; props: Record<string, unknown>; children: unknown[] };

function fakeReact(): { react: { createElement: (...args: unknown[]) => unknown }; calls: Call[] } {
  const calls: Call[] = [];
  const react = {
    createElement(...args: unknown[]) {
      const [tag, props, ...children] = args;
      calls.push({ tag: tag as string, props: props as Record<string, unknown>, children });
      return { tag, props };
    },
  };
  return { react, calls };
}

const card = el(
  "section",
  { "data-lane": "verifying", "aria-label": "Verifying, 1 card" },
  [
    txt("span", { class: "card-title" }, "Phase 3 — ship it"),
    el("div", { "data-card-id": "c-1" }, [txt("span", { class: "badge" }, "blocked")]),
  ],
);

test("one createElement call per node (children before their parent), depth first", () => {
  const { react, calls } = fakeReact();
  toReact(card, react);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.tag), ["span", "span", "div", "section"]);
});

test("attributes are passed through as strings, with a key", () => {
  const { react, calls } = fakeReact();
  toReact(card, react);
  assert.equal(calls[0]!.props.class, "card-title");
  assert.equal(calls[1]!.props.class, "badge");
  assert.equal(calls[2]!.props["data-card-id"], "c-1");
  assert.equal(calls[3]!.props["data-lane"], "verifying");
  assert.equal(calls[3]!.props["aria-label"], "Verifying, 1 card");
  assert.equal(typeof calls[3]!.props.key, "string");
});

test("text is passed only as a single string child", () => {
  const { react, calls } = fakeReact();
  toReact(card, react);
  assert.deepEqual(calls[0]!.children, ["Phase 3 — ship it"]);
  assert.deepEqual(calls[1]!.children, ["blocked"]);
  assert.deepEqual(calls[2]!.children.map((child) => typeof child), ["object"]);
  assert.deepEqual(calls[3]!.children.map((child) => typeof child), ["object", "object"]);
});

test("no dangerouslySetInnerHTML is ever supplied", () => {
  const { react, calls } = fakeReact();
  toReact(card, react);
  for (const call of calls) {
    assert.equal("dangerouslySetInnerHTML" in call.props, false);
    assert.equal("innerHTML" in call.props, false);
  }
});
