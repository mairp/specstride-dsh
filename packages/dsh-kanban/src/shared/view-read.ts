/**
 * T011 — the acceptance rule (PT-121-004, F121-FR-004; research.md R4).
 *
 * A value is accepted when `schema` is `specstride.view/<n>` with `n` inside
 * the generated major range and the fields the plugin reads have their JSON
 * types. Members of the three closed sets are NOT checked against the enums:
 * a newer engine inside the major renders with `?` (F121-FR-014).
 */
import { SCHEMA_ID, MAJOR_RANGE } from "./generated/contract-values.ts";

export type ViewCard = {
  id: string;
  feature: string | null;
  phase: number | null;
  lane: string;
  ruleId: string;
  flags: { dead?: boolean; stale?: boolean; yielded?: boolean };
  /** The card's one-line title (the workspace reader's), optional. */
  title?: string;
  /** The click-through detail of a phase card (F121-FR-022), optional and additive. */
  detail?: PhaseDetail;
};

/* ------------------------- the card detail (F121-FR-022..024) ------------------------- */

export type DetailTask = { id: string; text: string; done: boolean; parallel: boolean; story: string | null; verdict: string | null };
export type DetailUsage = {
  sessions: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  rateLimited: number;
  backoffMs: number;
  models: string[];
};
export type DetailAttempt = {
  attempt: number;
  run: string;
  launch: string | null;
  strategy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string;
  passes: number;
  errors: number;
};
export type DetailAgent = {
  role: string;
  what: string;
  since: string | null;
  pid: number | null;
  alive: boolean | null;
  harness: string | null;
  profile: string | null;
  model: string | null;
};
export type DetailLaunch = {
  launch: string;
  reason: string | null;
  state: string;
  at: string | null;
  endedAt: string | null;
  exit: string | null;
  run: string | null;
  current: boolean;
};
/** Phase scope, approval, evidence, attempts and usage of ONE phase. Every string ≤ 240 bytes, every list bounded. */
export type PhaseDetail = {
  goal: string | null;
  independentTest: string | null;
  checkpoint: string | null;
  tasksDone: number;
  tasksTotal: number;
  tasks: DetailTask[];
  tasksOmitted: number;
  files: string[];
  filesOmitted: number;
  approval: { at: string | null; attempt: string | null; critic: string | null; commit: string | null } | null;
  evidence: { name: string; bytes: number } | null;
  attempts: DetailAttempt[];
  attemptsOmitted: number;
  counters: { rejects: number; errors: number; noProgress: number; caps: number } | null;
  units: { total: number; unresolved: number; cycles: number } | null;
  usage: DetailUsage | null;
  /** True for the phase the feature's newest run is in (or ended in). */
  current: boolean;
};
/** What is shared by every card of a feature: the live run, its agents, launches, log tail, usage and limits. */
export type FeatureDetail = {
  run: { id: string; launch: string | null; state: string; phase: number | null; startedAt: string | null; lastAt: string | null } | null;
  agents: DetailAgent[];
  agentsNote: string | null;
  launches: DetailLaunch[];
  launchesOmitted: number;
  log: string[];
  usage: DetailUsage | null;
  cost: string;
  limits: string;
  usageNote: string | null;
};

export type ViewAttention = { kind: string; key: string; since: string | null; oneLine: string; need: string | null; next: string };
export type ViewBudget = {
  scope: string;
  role: string | null;
  level: string;
  spent: number | null;
  cap: number | null;
  fraction: number | null;
  quota: string;
};
export type ReadView = {
  schema: string;
  runId: string | null;
  workspaceId: string | null;
  feature: string | null;
  state: string;
  display: string;
  conditions: { dead: boolean; stale: null | { reason: string; majorFound?: number | null; majorsAccepted?: unknown }; launchAbandoned: boolean };
  cards: ViewCard[];
  lanes: { lane: string; cards: string[] }[];
  laneTable: { id: string; version: string };
  attention: ViewAttention[];
  attentionOmitted: number;
  budget: ViewBudget[];
  budgetOmitted: number;
  phases: { number: number; title: string | null }[];
  cursor: { offset: number; lastSeq: number };
  signature: { token: string };
  /** The reader's per-feature detail, keyed by feature (F121-FR-022), optional and additive. */
  featureDetails?: Record<string, FeatureDetail>;
  /** The server's clock when the view was built, optional. */
  now?: string;
};

export type AcceptResult = { ok: true; view: ReadView } | { ok: false; line: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): boolean => v === null || isStr(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const each = (v: unknown, test: (item: Rec) => boolean): boolean => Array.isArray(v) && v.every((item) => isRec(item) && test(item));

const SCHEMA_PATTERN = /^specstride\.view\/(\d+)$/;

function majorOf(schema: unknown): number | null {
  if (!isStr(schema)) return null;
  const match = SCHEMA_PATTERN.exec(schema);
  return match === null ? null : Number.parseInt(match[1] as string, 10);
}

function fieldsHoldTheirTypes(v: Rec): boolean {
  const conditions = v.conditions;
  return (
    isStrOrNull(v.runId) && isStrOrNull(v.workspaceId) && isStrOrNull(v.feature) &&
    isStr(v.state) && isStr(v.display) &&
    isRec(conditions) && isBool(conditions.dead) && isBool(conditions.launchAbandoned) &&
    (conditions.stale === null || (isRec(conditions.stale) && isStr(conditions.stale.reason))) &&
    each(v.cards, (c) => isStr(c.id) && isStrOrNull(c.feature) && (c.phase === null || isInt(c.phase)) && isStr(c.lane) && isStr(c.ruleId) && isRec(c.flags)) &&
    each(v.lanes, (l) => isStr(l.lane) && Array.isArray(l.cards) && l.cards.every(isStr)) &&
    isRec(v.laneTable) && isStr(v.laneTable.id) && isStr(v.laneTable.version) &&
    each(v.attention, (a) => isStr(a.kind) && isStr(a.key) && isStrOrNull(a.since) && isStr(a.oneLine) && isStrOrNull(a.need) && isStr(a.next)) &&
    isInt(v.attentionOmitted) && v.attentionOmitted >= 0 &&
    each(v.budget, (b) => isStr(b.scope) && isStrOrNull(b.role) && isStr(b.level) && isNumOrNull(b.spent) && isNumOrNull(b.cap) && isNumOrNull(b.fraction) && isStr(b.quota)) &&
    isInt(v.budgetOmitted) && v.budgetOmitted >= 0 &&
    each(v.phases, (p) => isInt(p.number) && isStrOrNull(p.title)) &&
    isRec(v.cursor) && isInt(v.cursor.offset) && isInt(v.cursor.lastSeq) &&
    isRec(v.signature) && isStr(v.signature.token)
  );
}

export function refusalLine(found: string): string {
  return `Kanban cannot read this view (schema ${found}, supported ${SCHEMA_ID}) — run /specstride-doctor`;
}

export function acceptView(value: unknown): AcceptResult {
  if (!isRec(value)) return { ok: false, line: refusalLine("none") };
  const found = isStr(value.schema) ? value.schema : "none";
  const major = majorOf(value.schema);
  if (major === null || major < MAJOR_RANGE.from || major > MAJOR_RANGE.to) return { ok: false, line: refusalLine(found) };
  if (!fieldsHoldTheirTypes(value)) return { ok: false, line: refusalLine(found) };
  return { ok: true, view: value as unknown as ReadView };
}
