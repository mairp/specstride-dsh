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
import { el, txt, type Node } from "./tree.ts";
import { boardOf, type BoardModel } from "./board-model.ts";
import { attentionPresentation, budgetPresentation, lanePresentation, type Presentation } from "./presentation.ts";
import { orbitOf, type Orbit } from "./orbit.ts";
import type { ReadView } from "./view-read.ts";
import { detailTree, shortTime } from "./detail-tree.ts";
import type { BoardCard } from "./board-model.ts";

export type TreeOptions = {
  /** The scoped class prefix, `.ssk-<8 hex of the package version hash>`; default the neutral placeholder. */
  prefix?: string;
  /** The projection: `"board"` (the lanes) or `"orbit"` (the rings); default `"board"`. */
  projection?: "board" | "orbit";
  /** The scroll position of each windowed column, in card rows, keyed by its `data-window` value. */
  scrollTops?: Readonly<Record<string, number>>;
  /** The card whose detail panel is open (F121-FR-022), or none. */
  selectedId?: string | null;
};

export const DEFAULT_PREFIX = "ssk-00000000";

/** The badge of one member: glyph text, the label as `aria-label`, the grayscale as `data-gray`. */
export function badge(prefix: string, presentation: Presentation): Node {
  return txt("span", {
    class: `${prefix}-badge`,
    "aria-label": presentation.label,
    "data-gray": String(presentation.grayscale),
  }, presentation.glyph);
}

/** A card node shown as pressed and selected (its detail panel is open). */
function pressed(node: Node): Node {
  return { ...node, attrs: { ...node.attrs, "aria-pressed": "true", "data-selected": "true" } };
}

/** The attention kind a banner's condition takes its presentation from. */
function conditionKind(condition: string): string {
  return condition === "dead" ? "dead-run" : condition === "stale" || condition === "client-stale" ? "stale-run" : condition;
}

/** The board of a view (the route's `view` answer) or of an already-built model. */
export function boardTree(input: ReadView | BoardModel, options: TreeOptions = {}): Node {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const board: BoardModel = "banners" in input ? (input as BoardModel) : boardOf(input as ReadView, { answer: "view" });

  if (options.projection === "orbit") {
    return orbitTree(orbitOf(board), { prefix });
  }

  const selected = options.selectedId ?? null;
  const children: Node[] = [];
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
  const lanes: Node[] = [];
  // An empty lane folds to a rail only beside a lane that holds cards.
  const anyCards = columns.some((column) => column.cards.length > 0);
  for (const column of columns) {
    const count = column.cards.length;
    const attrs: Record<string, string> = {
      "aria-label": `${column.label}, ${count} cards`,
      class: `${prefix}-column`,
    };
    if (column.lanes.length === 1) attrs["data-lane"] = column.lanes[0] ?? "";
    else attrs["data-lanes"] = column.lanes.join(" ");
    if (column.unknown) attrs["data-unknown-lane"] = "true";

    if (count === 0 && anyCards) attrs["data-empty"] = "true";

    const parts: Node[] = [
      el("div", { class: `${prefix}-column-header` }, [
        el("span", { class: `${prefix}-column-pill` }, [
          badge(prefix, lanePresentation(column.lanes[0] ?? "")),
          txt("span", { class: `${prefix}-column-label` }, column.label),
        ]),
        txt("span", { class: `${prefix}-column-count` }, String(count)),
      ]),
    ];
    if (column.lanes.length > 1) parts.push(txt("div", { class: `${prefix}-column-holds` }, `holds ${column.lanes.join(", ")}`));
    // A windowed column wraps its cards in one scroll container (`data-window`,
    // the one per column the adapter binds its scroll handler to); the position
    // the client holds travels as the plain `data-scroll-top` attribute (rows).
    const windowKey = attrs["data-lane"] ?? (attrs["data-lanes"] ?? "");
    const cardParts: Node[] = column.groups.map((group) => {
      const header = group.feature === null ? "no feature" : group.feature;
      return el("div", { "data-feature": group.feature ?? "", class: `${prefix}-group` }, [txt("h3", { class: `${prefix}-group-header` }, header), ...group.cards.map((card) => (card.id === selected ? pressed(card.node) : card.node))]);
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
    lanes.push(el("section", attrs, parts));
  }

  const view = "banners" in input ? null : (input as ReadView);
  const summary = board.windowed === true ? null : summaryTree(board, view, prefix);
  if (summary !== null) children.push(summary);

  if (board.attention.length > 0 || board.attentionMore > 0) {
    const rows = board.attention.map((row) => {
      const parts: Node[] = [
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

  // The lanes, and beside them the inspector of the selected card (F121-FR-022).
  const body: Node[] = [el("div", { class: `${prefix}-lanes` }, lanes)];
  const chosen = selected === null ? undefined : board.columns.flatMap((column) => column.cards).find((card) => card.id === selected);
  if (chosen !== undefined) {
    const feature = chosen.feature === null ? null : view?.featureDetails?.[chosen.feature] ?? null;
    body.push(detailTree(chosen, feature, prefix));
  }
  children.push(el("div", { class: `${prefix}-body` }, body));

  return el("div", {
    "data-kanban": "",
    class: `${prefix}-board`,
    role: "region",
    "aria-label": "Specstride run",
  }, children);
}

/** At most this many feature rows in the run strip; the rest are counted. */
export const SUMMARY_FEATURES = 4;

/**
 * The run strip above the lanes (direction B): one chip per column with its
 * glyph, label and card count, then one row per feature — its name, how many
 * of its cards sit on the approved lane, one segment per card in phase order
 * tinted by the lane the view gave it (decorative: the counts are the text),
 * and its run line when the view carries one. It only counts what the view
 * placed; it assigns no lane. Features with a run lead (live first, then the
 * newest last event), the rest keep their first appearance in `view.cards`
 * (the columns' order without a view). Pure.
 */
function summaryTree(board: BoardModel, view: ReadView | null, prefix: string): Node | null {
  const cards: BoardCard[] = board.columns.flatMap((column) => [...column.cards]);
  if (cards.length === 0) return null;
  const chips = board.columns.map((column) => {
    const count = column.cards.length;
    // `data-tint`, not `data-lane`: only columns and cards carry `data-lane` (F121-FR-009).
    const attrs: Record<string, string> = { class: `${prefix}-summary-chip`, "data-tint": column.lanes[0] ?? "" };
    if (count === 0) attrs["data-empty"] = "true";
    const presentation = lanePresentation(column.lanes[0] ?? "");
    return el("span", attrs, [
      badge(prefix, presentation),
      txt("span", {}, column.lanes.length === 1 ? presentation.label : column.label),
      txt("span", { class: `${prefix}-summary-count` }, String(count)),
    ]);
  });

  const order: string[] = [];
  const byFeature = new Map<string, BoardCard[]>();
  const seen = view === null ? cards.map((card) => card.feature) : view.cards.map((card) => card.feature);
  for (const feature of seen) {
    if (feature !== null && !byFeature.has(feature)) { byFeature.set(feature, []); order.push(feature); }
  }
  for (const card of cards) {
    if (card.feature === null) continue;
    if (!byFeature.has(card.feature)) { byFeature.set(card.feature, []); order.push(card.feature); }
    (byFeature.get(card.feature) as BoardCard[]).push(card);
  }
  // The features a run touched lead, the one being run first: a live run
  // (running or between passes) before an ended one, then the newest last
  // event; features never run follow in first-appearance order. In a
  // workspace holding a whole spec corpus this puts the feature at work on
  // top instead of the oldest specs. Re-reads the view's run facts only.
  const withCards = order.filter((feature) => (byFeature.get(feature) as BoardCard[]).length > 0);
  const runOf = (feature: string) => view?.featureDetails?.[feature]?.run ?? null;
  const live = (feature: string) => { const s = runOf(feature)?.state; return s === "running" || s === "between passes"; };
  const ran = withCards.filter((feature) => runOf(feature) !== null);
  const rank = new Map(withCards.map((feature, index) => [feature, index]));
  ran.sort((a, b) =>
    Number(live(b)) - Number(live(a))
    || (runOf(b)?.lastAt ?? "").localeCompare(runOf(a)?.lastAt ?? "")
    || (rank.get(a) as number) - (rank.get(b) as number));
  const shown = [...ran, ...withCards.filter((feature) => runOf(feature) === null)];
  const rows = shown.slice(0, SUMMARY_FEATURES).map((feature) => {
    const members = [...(byFeature.get(feature) as BoardCard[])].sort((a, b) =>
      (a.phase ?? Number.MAX_SAFE_INTEGER) - (b.phase ?? Number.MAX_SAFE_INTEGER));
    const approved = members.filter((card) => card.lane === "approved").length;
    const parts: Node[] = [
      el("div", { class: `${prefix}-summary-head` }, [
        txt("h2", { class: `${prefix}-summary-feature` }, feature),
        txt("span", { class: `${prefix}-summary-progress` }, `${approved} of ${members.length} approved`),
      ]),
      el("div", { class: `${prefix}-summary-track`, "aria-hidden": "true" },
        members.map((card) => el("span", { class: `${prefix}-summary-seg`, "data-tint": card.lane }))),
    ];
    const run = view?.featureDetails?.[feature]?.run ?? null;
    if (run !== null) {
      const line = [run.id, run.state, run.phase === null ? null : `phase ${run.phase}`, run.lastAt === null ? null : `last event ${shortTime(run.lastAt)}`]
        .filter((x) => x !== null).join(" · ");
      parts.push(txt("div", { class: `${prefix}-summary-run`, title: line }, line));
    }
    return el("div", { class: `${prefix}-summary-row`, "data-feature": feature }, parts);
  });
  const rest = shown.length - rows.length;
  if (rest > 0) rows.push(txt("div", { class: `${prefix}-summary-more` }, `and ${rest} more feature${rest === 1 ? "" : "s"}`));

  return el("div", { class: `${prefix}-summary`, "data-summary": "" }, [
    el("div", { class: `${prefix}-summary-chips` }, chips),
    ...(rows.length > 0 ? [el("div", { class: `${prefix}-summary-features` }, rows)] : []),
  ]);
}

/**
 * The orbit projection of the board (T047; F121-FR-021; contracts/orbit.md):
 * one dashed guide circle per ring (`data-ring`), one node per body
 * (`data-card-id`), and the text readout rendered as a list beside the figure —
 * the readout is the accessible name of the figure, so no fact rides on the
 * picture alone. Pure: the same orbit, the same tree.
 */
export function orbitTree(orbit: Orbit, options: TreeOptions = {}): Node {
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
