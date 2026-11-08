/**
 * T021 — the board element tree (contracts/presentation.md "Element tree and
 * attributes"; F121-FR-008, F121-FR-009, F121-FR-012, F121-FR-014).
 *
 * A pure function: equal input (view or board model of T020), equal tree —
 * byte-equal under `serialize`. Every run text enters as a `text` field of the
 * T006 tree; there is no markup path. Presentation (glyph, label, grayscale)
 * comes from T035; until it lands the tree carries the label text only, and
 * card flags render as badges with `aria-label` and the label as their text.
 */
import { el, txt, type Node } from "./tree.ts";
import { boardOf, type BoardModel } from "./board-model.ts";
import type { ReadView } from "./view-read.ts";

export type TreeOptions = {
  /** The scoped class prefix, `.ssk-<8 hex of the package version hash>`; default the neutral placeholder. */
  prefix?: string;
};

const DEFAULT_PREFIX = "ssk00000000";

/** The board of a view (the route's `view` answer) or of an already-built model. */
export function boardTree(input: ReadView | BoardModel, options: TreeOptions = {}): Node {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const board: BoardModel = "banners" in input ? (input as BoardModel) : boardOf(input as ReadView, { answer: "view" });

  const children: Node[] = [];
  for (const banner of board.banners) {
    children.push(txt("div", { role: "status", "data-condition": banner.condition }, banner.text));
  }
  if (board.noRun) {
    children.push(txt("div", { role: "status", "data-norun": "true" }, board.noRunText));
  }

  for (const column of board.columns) {
    const count = column.cards.length;
    const attrs: Record<string, string> = {
      "aria-label": `${column.label}, ${count} cards`,
    };
    if (column.lanes.length === 1) attrs["data-lane"] = column.lanes[0] ?? "";
    else attrs["data-lanes"] = column.lanes.join(" ");
    if (column.unknown) attrs["data-unknown-lane"] = "true";

    const parts: Node[] = [txt("div", {}, column.label)];
    if (column.lanes.length > 1) parts.push(txt("div", {}, `holds ${column.lanes.join(", ")}`));
    for (const group of column.groups) {
      const header = group.feature === null ? "no feature" : group.feature;
      parts.push(el("div", { "data-feature": group.feature ?? "" }, [txt("div", {}, header), ...group.cards.map((card) => card.node)]));
    }
    children.push(el("section", attrs, parts));
  }

  if (board.attention.length > 0 || board.attentionMore > 0) {
    const rows = board.attention.map((row) => {
      const parts = [txt("div", { "data-kind": row.kind }, row.oneLine)];
      if (row.need !== null) parts.push(txt("div", {}, row.need));
      return el("div", { "data-kind": row.kind }, parts);
    });
    if (board.attentionMore > 0) rows.push(txt("div", {}, `and ${board.attentionMore} more`));
    children.push(el("div", { "data-attention": "" }, rows));
  }

  if (board.budget.length > 0 || board.budgetMore > 0) {
    const rows = board.budget.map((row) => txt("div", { "data-level": row.level }, row.text));
    if (board.budgetMore > 0) rows.push(txt("div", {}, `and ${board.budgetMore} more`));
    children.push(el("div", { "data-budget": "" }, rows));
  }

  return el("div", {
    "data-kanban": "",
    role: "region",
    "aria-label": "Specstride run",
  }, children);
}
