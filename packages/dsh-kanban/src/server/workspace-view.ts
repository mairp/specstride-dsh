/**
 * The workspace reader: a `specstride.view/1` built straight from the files a
 * Specstride workspace already holds, for when no engine answers the
 * `kanban status --json` call. The pinned engine 0.1.0 has no `kanban` verb and
 * its `status` is not mounted, and the bash engine that produces your runs speaks
 * no protocol. Without this reader the tab could only ever say "unavailable".
 *
 * Sources, all read-only:
 *  - `specs/<feature>/tasks.md`: `## Phase N: <title>` headings, `- [x]` / `- [ ]` tasks;
 *  - `.specstride/features/<feature>/gates/GATE<N>-APPROVED`: the bash engine's approvals;
 *  - `.specstride/events.jsonl`: the bash engine's event stream (`event`, `feature`,
 *    `run_id`, `time`, `phase`, `run_end.outcome`);
 *  - `.specstride/workspace.json`: the workspace id.
 *
 * One card per phase per feature (the Lisa board: canonical lanes, cards grouped
 * by feature, read-only). Pure over a small filesystem port so tests inject files.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReadView, ViewAttention, ViewCard } from "../shared/view-read.ts";

export type FsPort = {
  /** Directory entries, or [] when absent. */
  list: (path: string) => string[];
  /** File text, or null when absent. */
  read: (path: string) => string | null;
  /** True when the path exists. */
  exists: (path: string) => boolean;
  /** Size in bytes, or 0. */
  size: (path: string) => number;
};

export const nodeFs: FsPort = {
  list: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  exists: (path) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  size: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  },
};

export const WORKSPACE_LANES = ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"] as const;
type Lane = (typeof WORKSPACE_LANES)[number];

/** A live run whose newest event is older than this is flagged stale. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** Bound on the event stream read (newest bytes kept). */
const EVENTS_TAIL_BYTES = 8 * 1024 * 1024;

type Phase = { number: number; title: string; tasks: number; ticked: number };

const PHASE_HEADING = /^##\s+Phase\s+(\d+)\s*[:.—-]?\s*(.*)$/;
const TASK_LINE = /^\s*-\s+\[([ xX])\]\s/;

export function parsePhases(text: string): Phase[] {
  const phases: Phase[] = [];
  let current: Phase | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = PHASE_HEADING.exec(line);
    if (heading !== null) {
      current = { number: Number.parseInt(heading[1] as string, 10), title: (heading[2] ?? "").trim(), tasks: 0, ticked: 0 };
      phases.push(current);
      continue;
    }
    if (/^##\s/.test(line)) {
      current = null;
      continue;
    }
    const task = TASK_LINE.exec(line);
    if (task !== null && current !== null) {
      current.tasks += 1;
      if (task[1] !== " ") current.ticked += 1;
    }
  }
  return phases;
}

type Event = { event: string; feature: string | null; runId: string | null; at: number | null; phase: number | null; outcome: string | null };

function toEvent(raw: unknown): Event | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const event = typeof r.event === "string" ? r.event : null;
  if (event === null) return null;
  const time = typeof r.time === "string" ? Date.parse(r.time) : Number.NaN;
  const ts = typeof r.ts === "string" ? Number.parseFloat(r.ts) * 1000 : Number.NaN;
  const phaseRaw = r.phase;
  const phase = typeof phaseRaw === "number" ? phaseRaw : typeof phaseRaw === "string" && /^\d+$/.test(phaseRaw) ? Number.parseInt(phaseRaw, 10) : null;
  return {
    event,
    feature: typeof r.feature === "string" ? r.feature : null,
    runId: typeof r.run_id === "string" ? r.run_id : null,
    at: Number.isFinite(time) ? time : Number.isFinite(ts) ? ts : null,
    phase,
    outcome: typeof r.outcome === "string" ? r.outcome : null,
  };
}

export function parseEvents(text: string): Event[] {
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const event = toEvent(JSON.parse(line));
      if (event !== null) out.push(event);
    } catch {
      // a torn or foreign line is skipped
    }
  }
  return out;
}

type RunFacts = {
  ended: boolean;
  outcome: string | null;
  currentPhase: number | null;
  activity: Lane | null;
  lastAt: number | null;
  done: Set<number>;
  /** TS engine only: the lane an ended run leaves its current phase in, when the run said so. */
  endLane?: Lane | null;
  /** TS engine only: why it ended, for the attention line. */
  why?: string | null;
  /** TS engine only: the pipeline log to read. */
  log?: string | null;
};

/** The facts of a feature's newest run; events without a feature join by run id. */
function latestRun(events: readonly Event[], feature: string): RunFacts | null {
  let runId: string | null = null;
  for (const e of events) if (e.feature === feature && e.runId !== null) runId = e.runId;
  if (runId === null) return null;
  const facts: RunFacts = { ended: false, outcome: null, currentPhase: null, activity: null, lastAt: null, done: new Set() };
  for (const e of events) {
    if (e.runId !== runId) continue;
    if (e.feature !== null && e.feature !== feature) continue;
    if (e.at !== null) facts.lastAt = e.at;
    switch (e.event) {
      case "phase_start":
        if (e.phase !== null) facts.currentPhase = e.phase;
        facts.activity = "proposing";
        break;
      case "proposer_start":
      case "iter_start":
      case "reject":
        facts.activity = "proposing";
        break;
      case "verification_start":
        facts.activity = "verifying";
        break;
      case "critic_start":
      case "verdict":
        facts.activity = "reviewing";
        break;
      case "phase_done": {
        const n = e.phase ?? facts.currentPhase;
        if (n !== null) facts.done.add(n);
        facts.activity = null;
        break;
      }
      case "run_end":
        facts.ended = true;
        facts.outcome = e.outcome;
        break;
    }
  }
  return facts;
}

function endLane(outcome: string | null): Lane {
  const o = (outcome ?? "").toLowerCase();
  if (/yield|pause|stop|quota/.test(o)) return "paused";
  if (/human|halt|block/.test(o)) return "blocked";
  return "failed";
}

export type WorkspaceCard = ViewCard & { title: string };

export function featureCards(feature: string, phases: readonly Phase[], approvedGates: ReadonlySet<number>, run: RunFacts | null, now: number): WorkspaceCard[] {
  const allApproved = run !== null && run.ended && run.outcome === "all_approved";
  const current = run?.currentPhase ?? null;
  return phases.map((phase) => {
    let lane: Lane = "queued";
    let stale = false;
    if (allApproved || approvedGates.has(phase.number) || run?.done.has(phase.number) === true || (phase.tasks > 0 && phase.ticked === phase.tasks)) {
      lane = "approved";
    } else if (run !== null && current === phase.number) {
      if (!run.ended) {
        lane = run.activity ?? "proposing";
        stale = run.lastAt !== null && now - run.lastAt > STALE_AFTER_MS;
      } else {
        lane = run.endLane ?? endLane(run.outcome);
      }
    }
    return {
      id: `${feature}#${phase.number}`,
      feature,
      phase: phase.number,
      lane,
      ruleId: `W-${lane}`,
      flags: { dead: false, stale, yielded: lane === "paused" },
      title: phase.title,
    };
  });
}

/* ------------------------- the TS engine (`specstride` 0.1.x) ------------------------- */

/**
 * The control roots the TS engine may keep a workspace's records under
 * (layout `<control>`): `~/.specstride/workspaces/<id[0:16]>` as observed, and
 * the full-id and XDG forms the layout names.
 */
export function controlRoots(workspaceId: string, home: string, env: Record<string, string | undefined> = process.env): string[] {
  const xdg = env.XDG_STATE_HOME ?? join(home, ".local", "state");
  const ids = [...new Set([workspaceId.slice(0, 16), workspaceId])];
  return [
    ...ids.map((id) => join(home, ".specstride", "workspaces", id)),
    ...ids.map((id) => join(xdg, "specstride", "workspaces", id)),
  ];
}

type TsEvent = { type: string; at: number | null; data: Record<string, unknown> };

export function parseTsEvents(text: string): TsEvent[] {
  const out: TsEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      if (typeof raw.type !== "string") continue;
      const at = typeof raw.at === "string" ? Date.parse(raw.at) : typeof raw.ts === "string" ? Date.parse(raw.ts) : Number.NaN;
      const data = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : {};
      out.push({ type: raw.type, at: Number.isFinite(at) ? at : null, data });
    } catch {
      // a torn or foreign line is skipped
    }
  }
  return out;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number.parseInt(v, 10) : null;

/** `phase.ended.outcome` (closed set 273; unknown reads as `halted`) → the lane it leaves. */
function phaseOutcomeLane(outcome: unknown): Lane | null {
  switch (outcome) {
    case "approved":
      return null;
    case "blocked":
      return "blocked";
    case "stopped":
      return "paused";
    default:
      return "failed";
  }
}

/** The facts of one TS-engine run, from its event stream. */
export function tsRunFacts(events: readonly TsEvent[]): RunFacts & { errors: Map<string, number> } {
  const facts: RunFacts & { errors: Map<string, number> } = {
    ended: false, outcome: null, currentPhase: null, activity: null, lastAt: null, done: new Set(), endLane: null, why: null, errors: new Map(),
  };
  for (const e of events) {
    if (e.at !== null) facts.lastAt = e.at;
    const phase = num(e.data.phase);
    switch (e.type) {
      case "phase.started":
        if (phase !== null) facts.currentPhase = phase;
        facts.activity = "proposing";
        facts.endLane = null;
        break;
      case "attempt.started":
      case "pass.started":
      case "iter_start":
      case "run.resumed":
      case "unblocked":
      case "yield.ended":
        facts.activity = "proposing";
        break;
      case "verification.started":
      case "check.started":
      case "job.started":
        facts.activity = "verifying";
        break;
      case "critic.started":
      case "critic.call":
      case "verdict.recorded":
        facts.activity = "reviewing";
        break;
      case "run.paused":
      case "yield.started":
        facts.activity = "paused";
        break;
      case "blocked":
        facts.activity = "blocked";
        break;
      case "iter_error": {
        const kind = typeof e.data.subtype === "string" ? e.data.subtype : typeof e.data.reason === "string" ? e.data.reason : "error";
        facts.errors.set(kind, (facts.errors.get(kind) ?? 0) + 1);
        break;
      }
      case "phase.ended": {
        const n = phase ?? facts.currentPhase;
        if (e.data.outcome === "approved") {
          if (n !== null) facts.done.add(n);
          facts.activity = null;
        } else {
          facts.endLane = phaseOutcomeLane(e.data.outcome);
          facts.why = `phase ${typeof e.data.outcome === "string" ? e.data.outcome : "halted"}`;
        }
        break;
      }
      case "run.ended":
        facts.ended = true;
        facts.outcome = typeof e.data.endCause === "string" ? e.data.endCause : "crash";
        break;
    }
  }
  return facts;
}

type PipelineEnd = { state: string; reason: string | null; at: number | null; log: string };

/** The newest pipeline record of a feature (`.specstride/state/pipeline/<f>/runs/<launch>/state.json`). */
function pipelineEnd(fs: FsPort, cwd: string, feature: string): PipelineEnd | null {
  const runs = join(cwd, ".specstride", "state", "pipeline", feature, "runs");
  let best: PipelineEnd | null = null;
  for (const launch of fs.list(runs)) {
    const raw = fs.read(join(runs, launch, "state.json"));
    if (raw === null) continue;
    try {
      const rec = JSON.parse(raw) as { state?: unknown; exit_reason?: unknown; updated_at?: unknown };
      if (typeof rec.state !== "string" || rec.state === "dry-run") continue;
      const at = typeof rec.updated_at === "number" ? rec.updated_at : null;
      if (best === null || (at ?? 0) > (best.at ?? 0)) {
        best = { state: rec.state, reason: typeof rec.exit_reason === "string" ? rec.exit_reason : null, at, log: join(runs, launch, "pipeline.log") };
      }
    } catch {
      // a torn record is skipped
    }
  }
  return best;
}

type TsFeature = { run: (RunFacts & { errors: Map<string, number> }) | null; approvals: Set<number>; size: number; count: number };

const RUN_ID = /^[\w.-]+$/;

/**
 * The run that speaks for a feature under one control root. `loop.json` names the run
 * the engine selected its strategy in, but the engine writes it once and leaves it on
 * later runs, so a relaunch would stay invisible behind it. The newest run whose
 * `phase.started` titles all belong to this feature wins instead (run directories
 * carry no feature name; the titles come from the feature's own `tasks.md`); the
 * `loop.json` run is the fallback when no run qualifies.
 */
function featureRunEvents(fs: FsPort, root: string, loopRunId: string | null, titles: ReadonlySet<string>): { path: string; events: TsEvent[] } | null {
  let best: { path: string; events: TsEvent[]; at: number } | null = null;
  let fallback: { path: string; events: TsEvent[] } | null = null;
  for (const runId of fs.list(join(root, "runs"))) {
    if (!RUN_ID.test(runId)) continue;
    const path = join(root, "runs", runId, "events.jsonl");
    const events = parseTsEvents(tailText(fs.read(path)));
    if (events.length === 0) continue;
    if (runId === loopRunId) fallback = { path, events };
    const started = events.filter((e) => e.type === "phase.started");
    const ours = started.length > 0 && started.every((e) => typeof e.data.title === "string" && titles.has(e.data.title.trim()));
    if (!ours) continue;
    const at = events.reduce((m, e) => (e.at !== null && e.at > m ? e.at : m), 0);
    if (best === null || at > best.at) best = { path, events, at };
  }
  return best ?? fallback;
}

/** Everything the TS engine recorded for one feature. */
function tsFeature(fs: FsPort, cwd: string, roots: readonly string[], feature: string, titles: ReadonlySet<string>): TsFeature {
  const approvals = new Set<number>();
  let run: TsFeature["run"] = null;
  let size = 0;
  let count = 0;
  for (const root of roots) {
    const dir = join(root, "features", feature);
    if (!fs.exists(dir)) continue;
    for (const name of fs.list(join(dir, "approvals"))) {
      const match = /^phase-(\d+)\.json$/.exec(name);
      if (match !== null) approvals.add(Number.parseInt(match[1] as string, 10));
    }
    const loop = fs.read(join(dir, "loop.json"));
    let runId: string | null = null;
    try {
      const id = loop === null ? null : (JSON.parse(loop) as { runId?: unknown }).runId;
      runId = typeof id === "string" && RUN_ID.test(id) ? id : null;
    } catch {
      runId = null;
    }
    const chosen = featureRunEvents(fs, root, runId, titles);
    if (chosen !== null) {
      run = tsRunFacts(chosen.events);
      size += fs.size(chosen.path);
      count += chosen.events.length;
    }
    break;
  }
  if (run !== null && !run.ended) {
    const end = pipelineEnd(fs, cwd, feature);
    // The pipeline record outlives an engine that died before `run.ended`.
    if (end !== null && end.state !== "running" && (end.at === null || run.lastAt === null || end.at >= run.lastAt)) {
      run.ended = true;
      run.outcome = end.state;
      run.log = end.log;
      if (run.endLane === null || run.endLane === undefined) run.endLane = end.state === "stopped" ? "paused" : end.state === "completed" ? null : "failed";
      run.why = [run.why, end.reason].filter((x) => x !== null && x !== undefined).join(", ") || null;
      if (end.at !== null && (run.lastAt === null || end.at > run.lastAt)) run.lastAt = end.at;
    }
  }
  return { run, approvals, size, count };
}

const TEXT_CAP = 240;
const cap = (text: string): string => {
  const bytes = Buffer.from(text, "utf8");
  return bytes.length <= TEXT_CAP ? text : `${bytes.subarray(0, TEXT_CAP - 3).toString("utf8").replace(/\uFFFD+$/, "")}...`;
};

/** The one attention item of a feature whose latest run ended failed or blocked. */
function endedAttention(feature: string, cards: readonly WorkspaceCard[], run: RunFacts & { errors?: Map<string, number> }): ViewAttention | null {
  const stuck = cards.find((c) => c.lane === "failed" || c.lane === "blocked");
  if (!run.ended || stuck === undefined) return null;
  const errors = [...(run.errors ?? new Map()).entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
  const why = [run.why, ...errors].filter((x) => typeof x === "string" && x !== "").join("; ");
  const where = stuck.phase === null ? "" : ` in phase ${stuck.phase}${stuck.title === "" ? "" : ` (${stuck.title})`}`;
  return {
    kind: "blocked-on-human",
    key: `${feature}#run`,
    since: run.lastAt === null ? null : new Date(run.lastAt).toISOString(),
    oneLine: cap(`${feature}: run ended ${stuck.lane}${where}${why === "" ? "" : ` — ${why}`}`),
    need: cap(run.log ? `read ${run.log}, fix the cause, then relaunch` : "read the run log, fix the cause, then relaunch"),
    next: "relaunch",
  };
}

function workspaceIdOf(fs: FsPort, cwd: string): string {
  const raw = fs.read(join(cwd, ".specstride", "workspace.json"));
  if (raw !== null) {
    try {
      const id = (JSON.parse(raw) as { workspaceId?: unknown }).workspaceId;
      if (typeof id === "string" && id !== "") return id;
    } catch {
      // fall through to the path
    }
  }
  return createHash("sha256").update(cwd).digest("hex").slice(0, 32);
}

function tailText(text: string | null): string {
  if (text === null) return "";
  if (text.length <= EVENTS_TAIL_BYTES) return text;
  const cut = text.slice(text.length - EVENTS_TAIL_BYTES);
  return cut.slice(cut.indexOf("\n") + 1);
}

/** The board of the workspace at `cwd`, or a `none` view when it holds no phased spec. */
export function readWorkspaceView(cwd: string, fs: FsPort = nodeFs, now: number = Date.now(), home: string = homedir()): ReadView & { now: string } {
  const eventsPath = join(cwd, ".specstride", "events.jsonl");
  const events = parseEvents(tailText(fs.read(eventsPath)));
  const workspaceId = workspaceIdOf(fs, cwd);
  const roots = controlRoots(workspaceId, home);
  const cards: WorkspaceCard[] = [];
  const attention: ViewAttention[] = [];
  let tsSize = 0;
  let tsCount = 0;
  for (const feature of fs.list(join(cwd, "specs")).sort()) {
    const tasks = fs.read(join(cwd, "specs", feature, "tasks.md"));
    if (tasks === null) continue;
    const phases = parsePhases(tasks);
    if (phases.length === 0) continue;
    const gates = new Set<number>();
    for (const name of fs.list(join(cwd, ".specstride", "features", feature, "gates"))) {
      const match = /^GATE(\d+)-APPROVED$/.exec(name);
      if (match !== null) gates.add(Number.parseInt(match[1] as string, 10));
    }
    const ts = tsFeature(fs, cwd, roots, feature, new Set(phases.map((p) => p.title)));
    for (const n of ts.approvals) gates.add(n);
    tsSize += ts.size;
    tsCount += ts.count;
    const bash = latestRun(events, feature);
    // The newer of the two engines' runs speaks for the feature.
    const run = ts.run !== null && (bash === null || (ts.run.lastAt ?? 0) >= (bash.lastAt ?? 0)) ? ts.run : bash;
    const touched = run !== null || gates.size > 0 || phases.some((p) => p.ticked > 0);
    if (!touched) {
      // A feature nothing has started yet is ONE queued card, not one per phase.
      cards.push({
        id: `${feature}#queued`,
        feature,
        phase: null,
        lane: "queued",
        ruleId: "W-queued",
        flags: { dead: false, stale: false, yielded: false },
        title: `not started (${phases.length} phases)`,
      });
      continue;
    }
    const mine = featureCards(feature, phases, gates, run, now);
    cards.push(...mine);
    const item = run === null ? null : endedAttention(feature, mine, run);
    if (item !== null) attention.push(item);
  }
  const live = cards.some((c) => (c.lane === "proposing" || c.lane === "verifying" || c.lane === "reviewing") && c.flags.stale !== true);
  const state = cards.length === 0 ? "none" : live ? "running" : "idle";
  const lanes = WORKSPACE_LANES.map((lane) => ({ lane, cards: cards.filter((c) => c.lane === lane).map((c) => c.id) }));
  const signature = createHash("sha256")
    .update(JSON.stringify([cards.map((c) => [c.id, c.lane, c.flags.stale]), attention.map((a) => [a.key, a.oneLine])]))
    .digest("hex");
  return {
    schema: "specstride.view/1",
    now: new Date(now).toISOString(),
    runId: `workspace:${workspaceId}`,
    workspaceId,
    feature: null,
    state,
    display: state,
    conditions: { dead: false, stale: null, launchAbandoned: false },
    cards,
    lanes,
    laneTable: { id: "workspace-reader", version: "1" },
    attention,
    attentionOmitted: 0,
    budget: [],
    budgetOmitted: 0,
    phases: [],
    cursor: { offset: fs.size(eventsPath) + tsSize, lastSeq: events.length + tsCount },
    signature: { token: signature },
  };
}

/** The cursor token the route hands out for a reader view (matches the route's cursor pattern). */
export function readerCursor(view: { cursor: { offset: number; lastSeq: number }; signature: { token: string } }): string {
  return `${view.cursor.offset}.${view.cursor.lastSeq}.${view.signature.token.slice(0, 8)}`;
}
