/**
 * T021 — the board element tree (contracts/presentation.md "Element tree and
 * attributes"; F121-FR-008, F121-FR-009, F121-FR-012, F121-FR-014); T035 —
 * presentation applied (F121-FR-013).
 *
 * A pure function: equal input (view or board model of T020), equal tree —
 * byte-equal under `serialize`. Every run text enters as a `text` field of the
 * T006 tree; there is no markup path. Every badge carries the three channels
 * together — the glyph as its text, the label as `aria-label`, the grayscale
 * as `data-gray` — from the one presentation table (T035); an unknown member
 * keeps its raw value as the label and the glyph `?` (F121-FR-014).
 */
import { el, txt,           } from "./tree.js";
import { boardOf,                 } from "./board-model.js";
import { attentionPresentation, budgetPresentation, lanePresentation,                   } from "./presentation.js";
                                               

                           
                                                                                                              
                  
  

export const DEFAULT_PREFIX = "ssk-00000000";

/** The badge of one member: glyph text, the label as `aria-label`, the grayscale as `data-gray`. */
export function badge(prefix        , presentation              )       {
  return txt("span", {
    class: `${prefix}-badge`,
    "aria-label": presentation.label,
    "data-gray": String(presentation.grayscale),
  }, presentation.glyph);
}

/** The attention kind a banner's condition takes its presentation from. */
function conditionKind(condition        )         {
  return condition === "dead" ? "dead-run" : condition === "stale" || condition === "client-stale" ? "stale-run" : condition;
}

/** The board of a view (the route's `view` answer) or of an already-built model. */
export function boardTree(input                       , options              = {})       {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const board             = "banners" in input ? (input              ) : boardOf(input            , { answer: "view" });

  const children         = [];
  for (const banner of board.banners) {
    children.push(badge(prefix, attentionPresentation(conditionKind(banner.condition))));
    children.push(txt("div", { role: "status", "data-condition": banner.condition, class: `${prefix}-banner` }, banner.text));
  }
  if (board.noRun) {
    children.push(txt("div", { role: "status", "data-norun": "true", class: `${prefix}-norun` }, board.noRunText));
  }

  for (const column of board.columns) {
    const count = column.cards.length;
    const attrs                         = {
      "aria-label": `${column.label}, ${count} cards`,
      class: `${prefix}-column`,
    };
    if (column.lanes.length === 1) attrs["data-lane"] = column.lanes[0] ?? "";
    else attrs["data-lanes"] = column.lanes.join(" ");
    if (column.unknown) attrs["data-unknown-lane"] = "true";

    const parts         = [
      el("div", { class: `${prefix}-column-header` }, [badge(prefix, lanePresentation(column.lanes[0] ?? "")), txt("span", {}, column.label)]),
    ];
    if (column.lanes.length > 1) parts.push(txt("div", { class: `${prefix}-column-holds` }, `holds ${column.lanes.join(", ")}`));
    for (const group of column.groups) {
      const header = group.feature === null ? "no feature" : group.feature;
      parts.push(el("div", { "data-feature": group.feature ?? "", class: `${prefix}-group` }, [txt("div", { class: `${prefix}-group-header` }, header), ...group.cards.map((card) => card.node)]));
    }
    children.push(el("section", attrs, parts));
  }

  if (board.attention.length > 0 || board.attentionMore > 0) {
    const rows = board.attention.map((row) => {
      const parts         = [
        el("div", { "data-kind": row.kind, class: `${prefix}-attention-line` }, [
          badge(prefix, attentionPresentation(row.kind)),
          txt("span", {}, row.oneLine),
        ]),
      ];
      if (row.need !== null) parts.push(txt("div", {}, row.need));
      return el("div", { "data-kind": row.kind }, parts);
    });
    if (board.attentionMore > 0) rows.push(txt("div", {}, `and ${board.attentionMore} more`));
    children.push(el("div", { "data-attention": "", class: `${prefix}-attention` }, rows));
  }

  if (board.budget.length > 0 || board.budgetMore > 0) {
    const rows = board.budget.map((row) =>
      el("div", { "data-level": row.level, class: `${prefix}-budget-row` }, [
        badge(prefix, budgetPresentation(row.level)),
        txt("span", {}, row.text),
      ]),
    );
    if (board.budgetMore > 0) rows.push(txt("div", {}, `and ${board.budgetMore} more`));
    children.push(el("div", { "data-budget": "", class: `${prefix}-budget` }, rows));
  }

  return el("div", {
    "data-kanban": "",
    class: `${prefix}-board`,
    role: "region",
    "aria-label": "Specstride run",
  }, children);
}
