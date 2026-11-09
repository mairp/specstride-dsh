/**
 * T021 — the board element tree (contracts/presentation.md "Element tree and
 * attributes"; F121-FR-008, F121-FR-009, F121-FR-012, F121-FR-014); T035 —
 * presentation applied (F121-FR-013); T047 — the windowed column and the
 * orbit/board toggle (F121-FR-020, F121-FR-021; contracts/orbit.md).
 *
 * A pure function: equal input (view or board model of T020), equal tree —
 * byte-equal under `serialize`. Every run text enters as a `text` field of the
 * T006 tree; there is no markup path. Every badge carries the three channels
 * together — the glyph as its text, the label as `aria-label`, the grayscale
 * as `data-gray` — from the one presentation table (T035); an unknown member
 * keeps its raw value as the label and the glyph `?` (F121-FR-014).
 *
 * Windowing (T047): on a windowed model (`windowOf`, the `windowed` flag) only
 * the columns that hold cards in the window become nodes — an empty lane
 * collapses out of the tree while the board is scrolled, and is back as soon as
 * the model is unwindowed. The model keeps all eight lanes; only the tree
 * differs (F121-FR-020).
 */
import { el, txt,           } from "./tree.js";
import { boardOf,                 } from "./board-model.js";
import { attentionPresentation, budgetPresentation, lanePresentation,                   } from "./presentation.js";
import { orbitOf,            } from "./orbit.js";
                                               
import { detailTree } from "./detail-tree.js";

                           
                                                                                                              
                  
                                                                                           
                                 
                                                                                                     
                                                
                                                                    
                             
  

export const DEFAULT_PREFIX = "ssk-00000000";

/** The badge of one member: glyph text, the label as `aria-label`, the grayscale as `data-gray`. */
export function badge(prefix        , presentation              )       {
  return txt("span", {
    class: `${prefix}-badge`,
    "aria-label": presentation.label,
    "data-gray": String(presentation.grayscale),
  }, presentation.glyph);
}

/** A card node shown as pressed and selected (its detail panel is open). */
function pressed(node      )       {
  return { ...node, attrs: { ...node.attrs, "aria-pressed": "true", "data-selected": "true" } };
}

/** The attention kind a banner's condition takes its presentation from. */
function conditionKind(condition        )         {
  return condition === "dead" ? "dead-run" : condition === "stale" || condition === "client-stale" ? "stale-run" : condition;
}

/** The board of a view (the route's `view` answer) or of an already-built model. */
export function boardTree(input                       , options              = {})       {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const board             = "banners" in input ? (input              ) : boardOf(input            , { answer: "view" });

  if (options.projection === "orbit") {
    return orbitTree(orbitOf(board), { prefix });
  }

  const selected = options.selectedId ?? null;
  const children         = [];
  for (const banner of board.banners) {
    children.push(badge(prefix, attentionPresentation(conditionKind(banner.condition))));
    children.push(txt("div", { role: "status", "data-condition": banner.condition, class: `${prefix}-banner` }, banner.text));
  }
  if (board.noRun) {
    children.push(txt("div", { role: "status", "data-norun": "true", class: `${prefix}-norun` }, board.noRunText));
  }

  // While the board is windowed, a lane with no cards in the window collapses
  // out of the tree; the model keeps all eight lanes (F121-FR-020).
  const columns = board.windowed ? board.columns.filter((column) => column.cards.length > 0) : board.columns;
  for (const column of columns) {
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
    // A windowed column wraps its cards in one scroll container (`data-window`,
    // the one per column the adapter binds its scroll handler to); the position
    // the client holds travels as the plain `data-scroll-top` attribute (rows).
    const windowKey = attrs["data-lane"] ?? (attrs["data-lanes"] ?? "");
    const cardParts         = column.groups.map((group) => {
      const header = group.feature === null ? "no feature" : group.feature;
      return el("div", { "data-feature": group.feature ?? "", class: `${prefix}-group` }, [txt("div", { class: `${prefix}-group-header` }, header), ...group.cards.map((card) => (card.id === selected ? pressed(card.node) : card.node))]);
    });
    if (board.windowed && column.cards.length > 0) {
      const scrollTop = options.scrollTops?.[windowKey];
      parts.push(el("div", {
        "data-window": windowKey,
        class: `${prefix}-column-scroll`,
        ...(scrollTop === undefined ? {} : { "data-scroll-top": String(scrollTop) }),
      }, cardParts));
    } else {
      parts.push(...cardParts);
    }
    children.push(el("section", attrs, parts));
  }

  // The detail panel of the selected card spans the board under its columns.
  const view = "banners" in input ? null : (input            );
  const chosen = selected === null ? undefined : board.columns.flatMap((column) => column.cards).find((card) => card.id === selected);
  if (chosen !== undefined) {
    const feature = chosen.feature === null ? null : view?.featureDetails?.[chosen.feature] ?? null;
    children.push(detailTree(chosen, feature, prefix));
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

/**
 * The orbit projection of the board (T047; F121-FR-021; contracts/orbit.md):
 * one dashed guide circle per ring (`data-ring`), one node per body
 * (`data-card-id`), and the text readout rendered as a list beside the figure —
 * the readout is the accessible name of the figure, so no fact rides on the
 * picture alone. Pure: the same orbit, the same tree.
 */
export function orbitTree(orbit       , options              = {})       {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const circles = orbit.rings.map((ring) =>
    el("circle", {
      "data-ring": ring.lane,
      class: `${prefix}-ring`,
      "aria-label": `${ring.label}, ${ring.count} cards`,
      r: String(ring.radius),
    }),
  );
  const bodies = orbit.rings.flatMap((ring) =>
    ring.cards.map((card) =>
      el("circle", {
        "data-card-id": card.cardId,
        "data-lane": card.lane,
        class: `${prefix}-body`,
        cx: String(card.x),
        cy: String(card.y),
        "aria-label": `${card.cardId} on ${card.lane}`,
      }),
    ),
  );
  const figure = el("svg", {
    "data-kanban-orbit": "",
    class: `${prefix}-orbit`,
    role: "img",
    "aria-label": orbit.lines.join("; "),
  }, [...circles, ...bodies]);
  const readout = el("ul", {
    "data-kanban-orbit-readout": "",
    class: `${prefix}-orbit-readout`,
  }, orbit.lines.map((line) => txt("li", { class: `${prefix}-orbit-line` }, line)));
  return el("div", { "data-kanban": "", class: `${prefix}-orbit-figure` }, [figure, readout]);
}
