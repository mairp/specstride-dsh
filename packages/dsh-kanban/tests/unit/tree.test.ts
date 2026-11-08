/** T006 — the element tree. */
import test from "node:test";
import assert from "node:assert/strict";
import { el, txt, serialize, cleanText } from "../../src/shared/tree.ts";

test("a node holds text or children, never both", () => {
  const leaf = txt("span", { class: "a" }, "hi");
  assert.equal(leaf.text, "hi");
  assert.deepEqual(leaf.children, []);
  const parent = el("div", {}, [leaf]);
  assert.equal(parent.text, undefined);
  assert.equal(parent.children.length, 1);
});

test("markup in text stays text", () => {
  const node = txt("p", {}, "<script>alert(1)</script>");
  assert.equal(node.text, "<script>alert(1)</script>");
});

test("attribute names innerHTML, dangerouslySetInnerHTML and on* are refused", () => {
  for (const name of ["innerHTML", "dangerouslySetInnerHTML", "onclick", "onerror", "onload"]) {
    assert.throws(() => el("div", { [name]: "x" }), /refused/, name);
    assert.throws(() => txt("div", { [name]: "x" }, "t"), /refused/, name);
  }
  assert.doesNotThrow(() => el("div", { "data-lane": "queued", "aria-label": "x" }));
});

test("control characters become U+FFFD, tab and newline-free text survive", () => {
  assert.equal(cleanText("a\u0007b"), "a�b");
  assert.equal(cleanText("a\tb"), "a\tb");
  assert.equal(cleanText("a\u007Fb\u009Fc"), "a�b�c");
  assert.equal(cleanText("a\u0000b\u001Fc"), "a�b�c");
  assert.equal(cleanText("a b"), "a b");
  assert.equal(txt("p", {}, "x\u0007").text, "x�");
});

test("serialize sorts attribute keys: equal trees are byte-equal", () => {
  const a = el("div", { b: "2", a: "1" }, [txt("i", { z: "1", y: "2" }, "t")]);
  const b = el("div", { a: "1", b: "2" }, [txt("i", { y: "2", z: "1" }, "t")]);
  assert.equal(serialize(a), serialize(b));
  assert.match(serialize(a), /"attrs":\{"a":"1","b":"2"\}/);
});
