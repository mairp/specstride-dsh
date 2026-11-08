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

/**
 * T047 — the scroll wiring of the windowed columns (F121-FR-020). One scroll
 * listener per windowed column (each `[data-window]` element of the rendered
 * board), reporting its position in card rows; no handler ever travels through
 * the tree itself (the T006 tree refuses `on*` attributes — the listener is
 * attached to the live element after the render). Returns the detacher, which
 * the pane calls on unmount so no listener outlives the tab.
 */
export const WINDOW_SELECTOR = "[data-window]";
/** The card row is a fixed 2rem: rows and pixels map 1:1 (40 px per row at the default root size). */
export const ROW_PX = 32;

export function bindColumnScroll(
  root: { querySelectorAll?: (selector: string) => IterableLike<{ addEventListener?: (type: string, listener: (event: { target?: { scrollTop?: number } }) => void) => void; removeEventListener?: (type: string, listener: (event: { target?: { scrollTop?: number } }) => void) => void; getAttribute?: (name: string) => string | null }> },
  onScroll: (windowKey: string, scrollTopRows: number) => void,
): () => void {
  const attached: { element: { removeEventListener?: (type: string, listener: (event: unknown) => void) => void }; listener: (event: unknown) => void }[] = [];
  const columns = root.querySelectorAll?.(WINDOW_SELECTOR) ?? [];
  for (const element of Array.from(columns as Iterable<{ addEventListener?: (type: string, listener: (event: { target?: { scrollTop?: number } }) => void) => void; removeEventListener?: (type: string, listener: (event: { target?: { scrollTop?: number } }) => void) => void; getAttribute?: (name: string) => string | null }>)) {
    const listener = (event: { target?: { scrollTop?: number } }): void => {
      const key = element.getAttribute?.("data-window") ?? "";
      const rows = Math.max(0, Math.round((event.target?.scrollTop ?? 0) / ROW_PX));
      onScroll(key, rows);
    };
    element.addEventListener?.("scroll", listener);
    attached.push({ element, listener: listener as (event: unknown) => void });
  }
  return () => {
    for (const { element, listener } of attached) {
      element.removeEventListener?.("scroll", listener as (event: unknown) => void);
    }
  };
}

type IterableLike<T> = { [Symbol.iterator]: () => Iterator<T> };
