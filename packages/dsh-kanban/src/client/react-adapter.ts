/**
 * T024 — the React adapter (F121-FR-003). The element tree becomes
 * `React.createElement` calls 1:1: one call per node, attributes passed
 * through as plain strings, text only ever a child string — there is no
 * `dangerouslySetInnerHTML` anywhere (F121-FR-012).
 */

type TreeNode = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly children: readonly TreeNode[];
};

type Reactish = { createElement: (...args: unknown[]) => unknown };

export function toReact(node: TreeNode, react: Reactish, key = "0"): unknown {
  const children =
    node.text !== undefined
      ? [node.text]
      : node.children.map((child, index) => toReact(child, react, `${key}.${index}`));
  return react.createElement(node.tag, { ...node.attrs, key }, ...children);
}
