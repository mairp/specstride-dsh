/**
 * T020 — the board model (contracts/presentation.md "Board model"; F121-FR-005,
 * F121-FR-006, F121-FR-008, F121-FR-010, F121-FR-014).
 *
 * Pure and DOM-free in its decisions: a function of the view and the options
 * only. A card's column is its own `card.lane` and nothing else — the engine
 * derived the lane, this plugin derives none (F121-FR-006; the scan rule
 * `no-lane-assignment` holds `columnOf` to `card.lane` only). No clock: the
 * client's staleness time arrives already formatted as a string.
 *
 * Each card carries the element-tree node its renderer will place (T021's
 * `cardNode`, built here so model and tree cannot drift); the decisions of the
 * model itself never read that node.
 */
import { LANES } from "./generated/contract-values.ts";
import { el, txt, type Node } from "./tree.ts";
import type { ReadView, ViewCard } from "./view-read.ts";

export type BoardCard = ViewCard & { node: Node };
export type CardGroup = { feature: string | null; cards: BoardCard[] };

export type ColumnModel = {
  /** Every lane the column holds, in board order; length 1 unless merged. */
  lanes: readonly string[];
  /** The header label: the lane, or every lane named, for a merged column. */
  label: string;
  /** True for a trailing column of a lane the engine's lane table does not name. */
  unknown: boolean;
  /** Cards grouped by feature; the null-feature group is last, labelled "no feature". */
  groups: readonly CardGroup[];
  /** Every card of the column, in column order (the groups, flattened). */
  cards: readonly BoardCard[];
};

export type BannerModel = { condition: "dead" | "stale" | "launch-abandoned" | "client-stale"; text: string };
export type AttentionRow = { kind: string; key: string; since: string | null; oneLine: string; need: string | null };
export type BudgetRow = { scope: string; role: string | null; level: string; spent: number | null; cap: number | null; text: string };

export type BoardModel = {
  columns: readonly ColumnModel[];
  banners: readonly BannerModel[];
  attention: readonly AttentionRow[];
  attentionMore: number;
  budget: readonly BudgetRow[];
  budgetMore: number;
  noRun: boolean;
  noRunText: string;
  /** Set by the windower (T047, `windowOf`): at least one column is windowed. A DOM-only concern. */
  windowed?: boolean;
};

export type BoardOptions = {
  /** The route answer this render belongs to ("view", "no-run", …). */
  answer?: string;
  /** Consumer-only merge: each inner array is one column holding those lanes. */
  merge?: readonly (readonly string[])[];
  /** Consumer-only hide: columns whose every lane is named here are dropped. */
  hide?: readonly string[];
  /** The client's own staleness, already formatted by the poller; no clock here. */
  clientStaleSince?: string | null;
};

export const NO_RUN_TEXT = "No Specstride run in this workspace";
export const NO_RUN_NOTE = "No run";
export const NO_FEATURE_LABEL = "no feature";

/* -------------------------------- card node (T021) -------------------------------- */

/**
 * The tree node of one card (contracts/presentation.md "Element tree"): exactly
 * the four attributes, so a test can deep-equal them; the text is the title,
 * inserted as text (F121-FR-012).
 */
/**
 * The card's one line. A titled card (the workspace reader's) sits under its
 * feature's group header, so it reads `phase N — <title>` (or the title alone
 * for a feature-level card); an untitled card keeps `<feature> · phase N`.
 */
function cardText(card: ViewCard, feature: string, phase: string): string {
  const title = (card as { title?: unknown }).title;
  if (typeof title !== "string" || title === "") return `${feature} · phase ${phase}`;
  return card.phase === null ? title : `phase ${phase} — ${title}`;
}

export function cardNode(card: ViewCard): Node {
  const feature = card.feature === null ? NO_FEATURE_LABEL : card.feature;
  const phase = card.phase === null ? "?" : String(card.phase);
  const flags: Node[] = [];
  const named: readonly [string, boolean | undefined][] = [
    ["dead", card.flags.dead],
    ["stale", card.flags.stale],
    ["yielded", card.flags.yielded],
  ];
  for (const [name, set] of named) {
    if (set === true) flags.push(txt("span", { "aria-label": name, "data-flag": name }, name));
  }
  return el("div", {
    "data-card-id": card.id,
    "data-lane": card.lane,
    "data-rule-id": card.ruleId,
    "data-feature": card.feature ?? "",
  }, [txt("span", {}, cardText(card, feature, phase)), ...flags]);
}

const boardCard = (card: ViewCard): BoardCard => ({ ...card, node: cardNode(card) });

/* ------------------------------ lane membership ---------------------------------- */

function isKnownLane(name: string): boolean {
  return (LANES as readonly string[]).includes(name);
}

/** Unknown lane values in order of first appearance, `view.lanes[]` then `view.cards[]`. */
function unknownLanesOf(view: ReadView): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!isKnownLane(name) && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  };
  for (const entry of view.lanes) push(entry.lane);
  for (const card of view.cards) push(card.lane);
  return found;
}

/** Lane membership, kept out of `columnOf` so its body reads `card.lane` only. */
function columnHolds(column: ColumnModel, name: string): boolean {
  return column.lanes.includes(name);
}

/**
 * The column that holds a card. Reads `card.lane` and nothing else of the card:
 * the placement is the engine's, never re-derived (F121-FR-006).
 */
export function columnOf(card: ViewCard, columns: readonly ColumnModel[]): ColumnModel | null {
  for (const column of columns) {
    if (columnHolds(column, card.lane)) return column;
  }
  return null;
}

/* ------------------------------ ordering and grouping ----------------------------- */

/** Card ids of one lane: `view.lanes[]` order first, then the rest in `view.cards` order. */
function orderedCardsOfLane(view: ReadView, name: string): ViewCard[] {
  const byId = new Map<string, ViewCard>();
  for (const card of view.cards) byId.set(card.id, card);
  const listed: ViewCard[] = [];
  const seen = new Set<string>();
  for (const entry of view.lanes) {
    if (entry.lane !== name) continue;
    for (const id of entry.cards) {
      const card = byId.get(id);
      if (card !== undefined && card.lane === name && !seen.has(id)) {
        seen.add(id);
        listed.push(card);
      }
    }
  }
  for (const card of view.cards) {
    if (card.lane === name && !seen.has(card.id)) {
      seen.add(card.id);
      listed.push(card);
    }
  }
  return listed;
}

/** Group by feature, first appearance first, the null-feature group last. */
function groupByFeature(cards: readonly BoardCard[]): CardGroup[] {
  const order: string[] = [];
  const byFeature = new Map<string | null, BoardCard[]>();
  for (const card of cards) {
    const feature = card.feature;
    if (!byFeature.has(feature)) {
      byFeature.set(feature, []);
      if (feature !== null) order.push(feature);
    }
    (byFeature.get(feature) as BoardCard[]).push(card);
  }
  const groups: CardGroup[] = [];
  for (const feature of order) groups.push({ feature, cards: byFeature.get(feature) as BoardCard[] });
  const none = byFeature.get(null);
  if (none !== undefined) groups.push({ feature: null, cards: none });
  return groups;
}

/* ---------------------------------- columns -------------------------------------- */

function emptyColumn(names: readonly string[], unknown: boolean): ColumnModel {
  return { lanes: [...names], label: names.join(", "), unknown, groups: [], cards: [] };
}

function columnsOf(view: ReadView | null): ColumnModel[] {
  const known: ColumnModel[] = LANES.map((name) => emptyColumn([name], false));
  const trailing: ColumnModel[] = unknownLanesOf(view ?? { lanes: [], cards: [] } as unknown as ReadView).map((name) =>
    emptyColumn([name], true),
  );
  return [...known, ...trailing];
}

function fillColumns(view: ReadView, columns: readonly ColumnModel[]): ColumnModel[] {
  return columns.map((column) => {
    const cards = column.lanes.flatMap((name) => orderedCardsOfLane(view, name)).map(boardCard);
    return { ...column, groups: groupByFeature(cards), cards };
  });
}

/** Consumer-only merge (F121-FR-006): one column per group, at the first member's place. */
function applyMerge(columns: readonly ColumnModel[], merge: readonly (readonly string[])[]): ColumnModel[] {
  let out = [...columns];
  for (const group of merge) {
    const members = group.map((name) => out.find((column) => column.lanes.length === 1 && column.lanes[0] === name));
    if (members.some((member) => member === undefined)) continue;
    const first = out.indexOf(members[0]);
    const mergedCards = members.flatMap((member) => [...(member as ColumnModel).cards]);
    const merged: ColumnModel = {
      lanes: members.map((member) => (member as ColumnModel).lanes[0] ?? ""),
      label: members.map((member) => (member as ColumnModel).label).join(", "),
      unknown: members.some((member) => (member as ColumnModel).unknown),
      groups: groupByFeature(mergedCards),
      cards: mergedCards,
    };
    const kept: ColumnModel[] = [];
    out.forEach((column, index) => {
      if (index === first) kept.push(merged);
      else if (!members.includes(column)) kept.push(column);
    });
    out = kept;
  }
  return out;
}

/** Consumer-only hide (F121-FR-006): a column whose every lane is hidden is dropped. */
function applyHide(columns: readonly ColumnModel[], hide: readonly string[]): ColumnModel[] {
  if (hide.length === 0) return [...columns];
  return columns.filter((column) => !column.lanes.every((name) => hide.includes(name)));
}

/* ------------------------------- banners and rows -------------------------------- */

function bannersOf(view: ReadView | null, options: BoardOptions): BannerModel[] {
  const banners: BannerModel[] = [];
  if (view !== null) {
    if (view.conditions.dead) banners.push({ condition: "dead", text: "Run is dead" });
    if (view.conditions.stale !== null) {
      banners.push({ condition: "stale", text: `View is stale: ${view.conditions.stale.reason}` });
    }
    if (view.conditions.launchAbandoned) banners.push({ condition: "launch-abandoned", text: "Launch abandoned" });
  }
  if (options.clientStaleSince !== undefined && options.clientStaleSince !== null) {
    banners.push({ condition: "client-stale", text: `Not updated since ${options.clientStaleSince}` });
  }
  return banners;
}

function attentionOf(view: ReadView | null): { rows: AttentionRow[]; more: number } {
  if (view === null) return { rows: [], more: 0 };
  return {
    rows: view.attention.map((item) => ({ kind: item.kind, key: item.key, since: item.since, oneLine: item.oneLine, need: item.need })),
    more: view.attentionOmitted,
  };
}

function budgetText(scope: string, role: string | null, level: string, spent: number | null, cap: number | null): string {
  const who = role === null ? scope : `${scope} ${role}`;
  const mark = (value: number | null) => (value === null ? "–" : String(value));
  return `${who} ${level} ${mark(spent)}/${mark(cap)}`;
}

function budgetOf(view: ReadView | null): { rows: BudgetRow[]; more: number } {
  if (view === null) return { rows: [], more: 0 };
  return {
    rows: view.budget.map((row) => ({
      scope: row.scope,
      role: row.role,
      level: row.level,
      spent: row.spent,
      cap: row.cap,
      text: budgetText(row.scope, row.role, row.level, row.spent, row.cap),
    })),
    more: view.budgetOmitted,
  };
}

/* ----------------------------------- boardOf -------------------------------------- */

export function boardOf(view: ReadView | null, options: BoardOptions = {}): BoardModel {
  const noRun = options.answer === "no-run" || (view !== null && view.state === "none");
  let columns = fillColumns(view ?? EMPTY_VIEW, columnsOf(view));
  columns = applyHide(applyMerge(columns, options.merge ?? []), options.hide ?? []);
  const attention = attentionOf(view);
  const budget = budgetOf(view);
  return {
    columns,
    banners: bannersOf(view, options),
    attention: attention.rows,
    attentionMore: attention.more,
    budget: budget.rows,
    budgetMore: budget.more,
    noRun,
    noRunText: NO_RUN_TEXT,
  };
}

/* --------------------- the T012 aliases (buildColumns, buildBoard) ----------------- */

export type ParityCard = { cardId: string; lane: string; ruleId: string; feature: string | null; phase: number | null };
export type ParityColumn = { lane: string | null; groups: { feature: string | null; cards: ParityCard[] }[] };
export type ParityBoard = { columns: ParityColumn[]; notes: string[] };

const parityCard = (card: BoardCard): ParityCard => ({ cardId: card.id, lane: card.lane, ruleId: card.ruleId, feature: card.feature, phase: card.phase });

/** The columns of the view alone (no consumer merge, no hide). */
export function buildColumns(view: ReadView): ParityColumn[] {
  return boardOf(view, { answer: "view" }).columns.map((column) => ({
    lane: column.lanes[0] ?? null,
    groups: column.groups.map((group) => ({ feature: group.feature, cards: group.cards.map(parityCard) })),
  }));
}

/** The columns plus the note lines ("No run" for a workspace without a run). */
export function buildBoard(view: ReadView): ParityBoard {
  const board = boardOf(view, { answer: "view" });
  return {
    columns: buildColumns(view),
    notes: board.noRun ? [NO_RUN_NOTE] : [],
  };
}

const EMPTY_VIEW: ReadView = {
  schema: "specstride.view/1",
  runId: null,
  workspaceId: null,
  feature: null,
  state: "none",
  display: "none",
  conditions: { dead: false, stale: null, launchAbandoned: false },
  cards: [],
  lanes: [],
  laneTable: { id: "lane-table", version: "1" },
  attention: [],
  attentionOmitted: 0,
  budget: [],
  budgetOmitted: 0,
  phases: [],
  cursor: { offset: 0, lastSeq: 0 },
  signature: { token: "" },
};
