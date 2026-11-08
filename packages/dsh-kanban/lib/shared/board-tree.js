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
import { el, txt,           } from "./tree.js";
import { boardOf,                 } from "./board-model.js";
                                               

                           
                                                                                                              
                  
  

const DEFAULT_PREFIX = "ssk00000000";

/** The board of a view (the route's `view` answer) or of an already-built model. */
export function boardTree(input                       , options              = {})       {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const board             = "banners" in input ? (input              ) : boardOf(input            , { answer: "view" });

  const children         = [];
  for (const banner of board.banners) {
    children.push(txt("div", { role: "status", "data-condition": banner.condition }, banner.text));
  }
  if (board.noRun) {
    children.push(txt("div", { role: "status", "data-norun": "true" }, board.noRunText));
  }

  for (const column of board.columns) {
    const count = column.cards.length;
    const attrs                         = {
      "aria-label": `${column.label}, ${count} cards`,
    };
    if (column.lanes.length === 1) attrs["data-lane"] = column.lanes[0] ?? "";
    else attrs["data-lanes"] = column.lanes.join(" ");
    if (column.unknown) attrs["data-unknown-lane"] = "true";

    const parts         = [txt("div", {}, column.label)];
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
