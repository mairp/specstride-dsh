/**
 * T006 — the element tree (research.md R7, data-model §9).
 *
 * Text is a separate field; there is no field for markup. A node never holds
 * both text and children. No attribute can be a handler or a markup sink.
 */
export type Node = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly children: readonly Node[];
};

const REFUSED_ATTRIBUTES = new Set(["innerHTML", "dangerouslySetInnerHTML"]);

function checkedAttrs(attrs: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(attrs)) {
    if (REFUSED_ATTRIBUTES.has(name) || name.startsWith("on")) {
      throw new Error(`tree: attribute "${name}" is refused (no markup sink, no handler in the tree)`);
    }
    out[name] = String(attrs[name]);
  }
  return out;
}

/** Control characters U+0000–U+001F except tab, and U+007F–U+009F, become U+FFFD. */
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g, "�");
}

export function el(tag: string, attrs: Readonly<Record<string, string>> = {}, children: readonly Node[] = []): Node {
  return { tag, attrs: checkedAttrs(attrs), children: [...children] };
}

export function txt(tag: string, attrs: Readonly<Record<string, string>>, text: string): Node {
  return { tag, attrs: checkedAttrs(attrs), text: cleanText(text), children: [] };
}

/** `JSON.stringify` with sorted attribute keys: equal trees give byte-equal text. */
export function serialize(node: Node): string {
  return JSON.stringify(node, (key, value: unknown) => {
    if (key === "attrs" && typeof value === "object" && value !== null) {
      const record = value as Record<string, string>;
      return Object.fromEntries(Object.keys(record).sort().map((name) => [name, record[name]]));
    }
    return value;
  });
}
