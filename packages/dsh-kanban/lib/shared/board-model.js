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
import { LANES } from "./generated/contract-values.js";
import { el, txt,           } from "./tree.js";
                                                         

                                                  
                                                                       

                           
                                                                             
                           
                                                                              
                
                                                                                    
                   
                                                                                         
                               
                                                                           
                              
  

                                                                                                              
                                                                                                                     
                                                                                                                                      

                          
                                  
                                  
                                     
                        
                               
                     
                 
                    
                                                                                                     
                     
  

                            
                                                                       
                  
                                                                                 
                                         
                                                                                
                           
                                                                                    
                                   
  

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
function cardText(card          , feature        , phase        )         {
  const title = (card                       ).title;
  if (typeof title !== "string" || title === "") return `${feature} · phase ${phase}`;
  return card.phase === null ? title : `phase ${phase} — ${title}`;
}

export function cardNode(card          )       {
  const feature = card.feature === null ? NO_FEATURE_LABEL : card.feature;
  const phase = card.phase === null ? "?" : String(card.phase);
  const flags         = [];
  const named                                           = [
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

const boardCard = (card          )            => ({ ...card, node: cardNode(card) });

/* ------------------------------ lane membership ---------------------------------- */

function isKnownLane(name        )          {
  return (LANES                     ).includes(name);
}

/** Unknown lane values in order of first appearance, `view.lanes[]` then `view.cards[]`. */
function unknownLanesOf(view          )           {
  const found           = [];
  const seen = new Set        ();
  const push = (name        ) => {
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
function columnHolds(column             , name        )          {
  return column.lanes.includes(name);
}

/**
 * The column that holds a card. Reads `card.lane` and nothing else of the card:
 * the placement is the engine's, never re-derived (F121-FR-006).
 */
export function columnOf(card          , columns                        )                     {
  for (const column of columns) {
    if (columnHolds(column, card.lane)) return column;
  }
  return null;
}

/* ------------------------------ ordering and grouping ----------------------------- */

/** Card ids of one lane: `view.lanes[]` order first, then the rest in `view.cards` order. */
function orderedCardsOfLane(view          , name        )             {
  const byId = new Map                  ();
  for (const card of view.cards) byId.set(card.id, card);
  const listed             = [];
  const seen = new Set        ();
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
function groupByFeature(cards                      )              {
  const order           = [];
  const byFeature = new Map                            ();
  for (const card of cards) {
    const feature = card.feature;
    if (!byFeature.has(feature)) {
      byFeature.set(feature, []);
      if (feature !== null) order.push(feature);
    }
    (byFeature.get(feature)               ).push(card);
  }
  const groups              = [];
  for (const feature of order) groups.push({ feature, cards: byFeature.get(feature)                });
  const none = byFeature.get(null);
  if (none !== undefined) groups.push({ feature: null, cards: none });
  return groups;
}

/* ---------------------------------- columns -------------------------------------- */

function emptyColumn(names                   , unknown         )              {
  return { lanes: [...names], label: names.join(", "), unknown, groups: [], cards: [] };
}

function columnsOf(view                 )                {
  const known                = LANES.map((name) => emptyColumn([name], false));
  const trailing                = unknownLanesOf(view ?? { lanes: [], cards: [] }                       ).map((name) =>
    emptyColumn([name], true),
  );
  return [...known, ...trailing];
}

function fillColumns(view          , columns                        )                {
  return columns.map((column) => {
    const cards = column.lanes.flatMap((name) => orderedCardsOfLane(view, name)).map(boardCard);
    return { ...column, groups: groupByFeature(cards), cards };
  });
}

/** Consumer-only merge (F121-FR-006): one column per group, at the first member's place. */
function applyMerge(columns                        , merge                                )                {
  let out = [...columns];
  for (const group of merge) {
    const members = group.map((name) => out.find((column) => column.lanes.length === 1 && column.lanes[0] === name));
    if (members.some((member) => member === undefined)) continue;
    const first = out.indexOf(members[0]);
    const mergedCards = members.flatMap((member) => [...(member               ).cards]);
    const merged              = {
      lanes: members.map((member) => (member               ).lanes[0] ?? ""),
      label: members.map((member) => (member               ).label).join(", "),
      unknown: members.some((member) => (member               ).unknown),
      groups: groupByFeature(mergedCards),
      cards: mergedCards,
    };
    const kept                = [];
    out.forEach((column, index) => {
      if (index === first) kept.push(merged);
      else if (!members.includes(column)) kept.push(column);
    });
    out = kept;
  }
  return out;
}

/** Consumer-only hide (F121-FR-006): a column whose every lane is hidden is dropped. */
function applyHide(columns                        , hide                   )                {
  if (hide.length === 0) return [...columns];
  return columns.filter((column) => !column.lanes.every((name) => hide.includes(name)));
}

/* ------------------------------- banners and rows -------------------------------- */

function bannersOf(view                 , options              )                {
  const banners                = [];
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

function attentionOf(view                 )                                         {
  if (view === null) return { rows: [], more: 0 };
  return {
    rows: view.attention.map((item) => ({ kind: item.kind, key: item.key, since: item.since, oneLine: item.oneLine, need: item.need })),
    more: view.attentionOmitted,
  };
}

function budgetText(scope        , role               , level        , spent               , cap               )         {
  const who = role === null ? scope : `${scope} ${role}`;
  const mark = (value               ) => (value === null ? "–" : String(value));
  return `${who} ${level} ${mark(spent)}/${mark(cap)}`;
}

function budgetOf(view                 )                                      {
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

export function boardOf(view                 , options               = {})             {
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

                                                                                                                        
                                                                                                              
                                                                       

const parityCard = (card           )             => ({ cardId: card.id, lane: card.lane, ruleId: card.ruleId, feature: card.feature, phase: card.phase });

/** The columns of the view alone (no consumer merge, no hide). */
export function buildColumns(view          )                 {
  return boardOf(view, { answer: "view" }).columns.map((column) => ({
    lane: column.lanes[0] ?? null,
    groups: column.groups.map((group) => ({ feature: group.feature, cards: group.cards.map(parityCard) })),
  }));
}

/** The columns plus the note lines ("No run" for a workspace without a run). */
export function buildBoard(view          )              {
  const board = boardOf(view, { answer: "view" });
  return {
    columns: buildColumns(view),
    notes: board.noRun ? [NO_RUN_NOTE] : [],
  };
}

const EMPTY_VIEW           = {
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
