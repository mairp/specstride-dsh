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
                                                                                                            
import {
  capText,
  describeProcess,
  feedbackVerdicts,
  isAlive,
  launchOfRun,
  logTail,
  MAX_AGENTS,
  MAX_ATTEMPTS,
  MAX_LAUNCHES,
  openActivity,
  parseScopes,
  phaseAttempts,
  pickRun,
  procPortOf,
  readLaunches,
  readProcRegistry,
  safePath,
                    
                
                 
} from "./run-detail.js";
import { featureSessions,                     } from "./dsh-sessions.js";

                      
                                              
                                   
                                        
                                        
                                   
                                    
                             
                                 
                                                                                            
                                              
  

export const nodeFs         = {
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
  bytes: (path) => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  },
};

export const WORKSPACE_LANES = ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"]         ;
                                             

/** A live run whose newest event is older than this is flagged stale. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** Bound on the event stream read (newest bytes kept). */
const EVENTS_TAIL_BYTES = 8 * 1024 * 1024;

                                                                              

const PHASE_HEADING = /^##\s+Phase\s+(\d+)\s*[:.—-]?\s*(.*)$/;
const TASK_LINE = /^\s*-\s+\[([ xX])\]\s/;

export function parsePhases(text        )          {
  const phases          = [];
  let current               = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = PHASE_HEADING.exec(line);
    if (heading !== null) {
      current = { number: Number.parseInt(heading[1]          , 10), title: (heading[2] ?? "").trim(), tasks: 0, ticked: 0 };
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

                                                                                                                                              

function toEvent(raw         )               {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw                           ;
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

export function parseEvents(text        )          {
  const out          = [];
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

                 
                 
                         
                              
                        
                        
                    
                                                                                                 
                        
                                                              
                      
                                                  
                      
  

/** The facts of a feature's newest run; events without a feature join by run id. */
function latestRun(events                  , feature        )                  {
  let runId                = null;
  for (const e of events) if (e.feature === feature && e.runId !== null) runId = e.runId;
  if (runId === null) return null;
  const facts           = { ended: false, outcome: null, currentPhase: null, activity: null, lastAt: null, done: new Set() };
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

function endLane(outcome               )       {
  const o = (outcome ?? "").toLowerCase();
  if (/yield|pause|stop|quota/.test(o)) return "paused";
  if (/human|halt|block/.test(o)) return "blocked";
  return "failed";
}

                                                         

export function featureCards(feature        , phases                  , approvedGates                     , run                 , now        )                  {
  const allApproved = run !== null && run.ended && run.outcome === "all_approved";
  const current = run?.currentPhase ?? null;
  return phases.map((phase) => {
    let lane       = "queued";
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
export function controlRoots(workspaceId        , home        , env                                     = process.env)           {
  const xdg = env.XDG_STATE_HOME ?? join(home, ".local", "state");
  const ids = [...new Set([workspaceId.slice(0, 16), workspaceId])];
  return [
    ...ids.map((id) => join(home, ".specstride", "workspaces", id)),
    ...ids.map((id) => join(xdg, "specstride", "workspaces", id)),
  ];
}

                                                                                  

export function parseTsEvents(text        )            {
  const out            = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line)                           ;
      if (typeof raw.type !== "string") continue;
      const at = typeof raw.at === "string" ? Date.parse(raw.at) : typeof raw.ts === "string" ? Date.parse(raw.ts) : Number.NaN;
      const data = typeof raw.data === "object" && raw.data !== null ? (raw.data                           ) : {};
      out.push({ type: raw.type, at: Number.isFinite(at) ? at : null, data });
    } catch {
      // a torn or foreign line is skipped
    }
  }
  return out;
}

const num = (v         )                =>
  typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number.parseInt(v, 10) : null;

/** `phase.ended.outcome` (closed set 273; unknown reads as `halted`) → the lane it leaves. */
function phaseOutcomeLane(outcome         )              {
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
export function tsRunFacts(events                    )                                             {
  const facts                                             = {
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

                                                                                            

/** The newest pipeline record of a feature (`.specstride/state/pipeline/<f>/runs/<launch>/state.json`). */
function pipelineEnd(fs        , cwd        , feature        )                     {
  const runs = join(cwd, ".specstride", "state", "pipeline", feature, "runs");
  let best                     = null;
  for (const launch of fs.list(runs)) {
    const raw = fs.read(join(runs, launch, "state.json"));
    if (raw === null) continue;
    try {
      const rec = JSON.parse(raw)                                                                    ;
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

                  
                                                           
                         
               
                
                                                                                         
                    
                           
                      
  

const RUN_ID = /^[\w.-]+$/;

/**
 * The runs of a feature under one control root (run directories carry no
 * feature name): a run is the feature's when every `phase.started` title
 * belongs to the feature's own `tasks.md`; the `loop.json` run is taken as
 * well when no run qualifies (an engine that names no titles). Each run comes
 * with its alive registry entries, verified against `/proc`.
 */
function featureRuns(fs        , root        , loopRunId               , titles                     , proc          )              {
  const registry = readProcRegistry(fs, root);
  const ours              = [];
  let fallback                   = null;
  for (const runId of fs.list(join(root, "runs"))) {
    if (!RUN_ID.test(runId)) continue;
    const path = join(root, "runs", runId, "events.jsonl");
    const events = parseTsEvents(tailText(fs.read(path)));
    if (events.length === 0) continue;
    const ats = events.map((e) => e.at).filter((a)              => a !== null);
    const record            = {
      runId,
      events,
      firstAt: ats.length === 0 ? null : Math.min(...ats),
      lastAt: ats.length === 0 ? null : Math.max(...ats),
      ended: events.some((e) => e.type === "run.ended"),
      live: registry.filter((r) => r.runId === runId && isAlive(proc, r.pid, r.startedAtMs)).map((r) => ({ pid: r.pid, kind: r.kind, startedAtMs: r.startedAtMs })),
    };
    (record                                ).size = fs.size(path);
    if (runId === loopRunId) fallback = record;
    const started = events.filter((e) => e.type === "phase.started");
    const mine = started.length > 0 && started.every((e) => typeof e.data.title === "string" && titles.has(e.data.title.trim()));
    if (mine) ours.push(record);
  }
  return ours.length > 0 ? ours : fallback === null ? [] : [fallback];
}

/** Everything the TS engine recorded for one feature. */
function tsFeature(fs        , cwd        , roots                   , feature        , titles                     , proc          , launches                         , now        )            {
  const approvals = new Set        ();
  let run                   = null;
  let size = 0;
  let count = 0;
  let runs              = [];
  let chosen                   = null;
  let chosenRoot                = null;
  for (const root of roots) {
    const dir = join(root, "features", feature);
    if (!fs.exists(dir)) continue;
    chosenRoot = root;
    for (const name of fs.list(join(dir, "approvals"))) {
      const match = /^phase-(\d+)\.json$/.exec(name);
      if (match !== null) approvals.add(Number.parseInt(match[1]          , 10));
    }
    const loop = fs.read(join(dir, "loop.json"));
    let runId                = null;
    try {
      const id = loop === null ? null : (JSON.parse(loop)                       ).runId;
      runId = typeof id === "string" && RUN_ID.test(id) ? id : null;
    } catch {
      runId = null;
    }
    runs = featureRuns(fs, root, runId, titles, proc);
    chosen = pickRun(runs);
    if (chosen !== null) {
      run = tsRunFacts(chosen.events);
      size += (chosen                                 ).size ?? 0;
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
  if (run !== null && !run.ended && chosen !== null && chosen.live.length === 0) {
    // No process of the run is alive. Its launch decides: still running (between
    // passes) → keep it live; stopped by a signal → paused; gone without an exit
    // record → the run was lost. A run started by hand (no launch) is judged
    // lost once it has been silent for two minutes (only where the engine keeps a registry).
    const launch = launchOfRun(chosen, launches);
    const silentFor = run.lastAt === null ? Number.POSITIVE_INFINITY : now - run.lastAt;
    // Without a process registry (an engine that keeps none) nothing is judged.
    const registry = chosenRoot !== null && fs.exists(join(chosenRoot, "procs.json"));
    const gone = launch === null ? registry && silentFor > 2 * 60 * 1000 : launch.state !== "running";
    if (gone) {
      run.ended = true;
      run.outcome = launch?.state ?? "lost";
      run.endLane = launch?.state === "signalled" || launch?.state === "stopped" || launch?.stopRequested === true ? "paused" : (launch?.state === "exited" && launch.exitCode === 0) || launch?.state === "completed" ? null : "failed";
      const how = launch === null
        ? "no process of the run is alive"
        : launch.state === "signalled" ? `launch ${launch.launchId} stopped by ${launch.signal}`
        : launch.state === "lost" ? `launch ${launch.launchId} is gone (no exit record)`
        : `launch ${launch.launchId} ${launch.state}${launch.exitReason ? ` (${launch.exitReason})` : launch.state === "exited" ? ` ${launch.exitCode ?? "?"}` : ""}`;
      run.why = [run.why, how].filter((x) => x !== null && x !== undefined && x !== "").join(", ");
      if (launch?.log !== null && launch?.log !== undefined) run.log = launch.log;
    }
  }
  return { run, approvals, size, count, runs, chosen, root: chosenRoot };
}

/* ------------------------------ the card detail (F121-FR-022) ------------------------------ */

const ROLE_OF_KIND                                   = { "pass-in-flight": "proposer" };
const SESSIONS_ROOT = (home        )         => join(home, ".dsh", "sessions");

function jsonAt(fs        , path        )                                 {
  if (fs.size(path) > 256 * 1024) return null;
  const raw = fs.read(path);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw)           ;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v                           ) : null;
  } catch {
    return null;
  }
}

const n0 = (v         )         => (typeof v === "number" && Number.isFinite(v) ? v : Array.isArray(v) ? v.length : 0);
const isoOf = (ms                           )                => (ms === null || ms === undefined || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

function usageOf(sessions                           )                                                      {
  if (sessions.length === 0) return null;
  const models = new Set        ();
  let calls = 0, tokensIn = 0, tokensOut = 0, retries = 0, rateLimited = 0, backoffMs = 0;
  for (const s of sessions) {
    calls += s.calls;
    tokensIn += s.tokensIn;
    tokensOut += s.tokensOut;
    retries += s.retries;
    rateLimited += s.rateLimited;
    backoffMs += Math.round(s.backoffMs);
    if (s.model !== null) models.add(capText(s.provider === null ? s.model : `${s.provider}/${s.model}`, 80));
  }
  return { sessions: sessions.length, calls, tokensIn, tokensOut, retries, rateLimited, backoffMs, models: [...models].sort().slice(0, 6) };
}

/** The phase a run was in at a moment (its newest `phase.started` at or before it). */
function phaseAtOf(runs                      )                                                      {
  return (runId, at) => {
    const run = runs.find((r) => r.runId === runId);
    if (run === undefined || at === null) return null;
    let phase                = null;
    for (const e of run.events) {
      if (e.at !== null && e.at > at) break;
      if (e.type === "phase.started" && typeof e.data.phase === "number") phase = e.data.phase;
    }
    return phase;
  };
}

                                                                                            

/** The detail of every phase card of a feature and the feature's shared detail. */
export function buildDetails(
  fs        ,
  cwd        ,
  home        ,
  feature        ,
  tasksText        ,
  ts           ,
  run                 ,
  launches                         ,
  proc          ,
)        {
  const scopes = parseScopes(tasksText);
  const featureDir = ts.root === null ? null : join(ts.root, "features", feature);
  const ledger = featureDir === null ? null : jsonAt(fs, join(featureDir, "ledger.json"));
  const mine = launches.filter((l) => l.feature === feature);
  const launchOf = (r           )                      => launchOfRun(r, mine);
  const chosen = ts.chosen;
  const liveRunId = chosen !== null && chosen.live.length > 0 ? chosen.runId : null;
  const current = run !== null && !run.ended ? run.currentPhase : null;
  const endedIn = run !== null && run.ended ? run.currentPhase : null;

  let sessions                   = [];
  const bytes = fs.bytes;
  if (bytes !== undefined) {
    try {
      sessions = featureSessions(
        { list: fs.list, size: fs.size, bytes },
        SESSIONS_ROOT(home),
        cwd,
        feature,
        new Set(scopes.keys()),
        ts.runs.map((r) => r.runId),
        phaseAtOf(ts.runs),
      );
    } catch {
      sessions = [];
    }
  }

  const phases = new Map                     ();
  for (const [n, scope] of scopes) {
    const verdicts = featureDir === null ? new Map                () : feedbackVerdicts(fs, featureDir, n);
    const approvalRec = featureDir === null ? null : jsonAt(fs, join(featureDir, "approvals", `phase-${n}.json`));
    const bound = featureDir === null ? null : jsonAt(fs, join(featureDir, "bound", `phase${n}.json`));
    const critic = (approvalRec?.critic ?? null)                                  ;
    const evidencePath = [
      join(cwd, ".specstride", "features", feature, "evidence", `GATE${n}-EVIDENCE.md`),
      join(cwd, ".specstride", "features", feature, "gates", `GATE${n}-EVIDENCE.md`),
    ].find((p) => fs.exists(p));
    const phaseLedger = (ledger?.[String(n)] ?? null)                                  ;
    const passLoop = (phaseLedger?.passLoop ?? {})                           ;
    const micro = featureDir === null ? null : jsonAt(fs, join(featureDir, "micro", `phase${n}.json`));
    const attempts = phaseAttempts(n, ts.runs, launchOf, liveRunId);
    const commit = bound !== null && typeof bound.commit === "string" ? bound.commit.slice(0, 12) : null;
    phases.set(n, {
      goal: scope.goal,
      independentTest: scope.independentTest,
      checkpoint: scope.checkpoint,
      tasksDone: scope.tasksDone,
      tasksTotal: scope.tasksTotal,
      tasks: scope.tasks.map((t) => ({ ...t, verdict: verdicts.get(t.id) ?? null })),
      tasksOmitted: scope.tasksOmitted,
      files: scope.files,
      filesOmitted: scope.filesOmitted,
      approval: approvalRec === null ? null : {
        at: typeof approvalRec.approvedAt === "string" ? capText(approvalRec.approvedAt, 40) : null,
        attempt: typeof approvalRec.attemptId === "string" ? capText(approvalRec.attemptId, 40) : null,
        critic: typeof critic?.model === "string" ? capText(critic.model, 80) : typeof critic?.provider === "string" ? capText(critic.provider, 80) : null,
        commit,
      },
      evidence: evidencePath === undefined ? null : { name: safePath(evidencePath, cwd, home), bytes: fs.size(evidencePath) },
      attempts: attempts.slice(-MAX_ATTEMPTS),
      attemptsOmitted: Math.max(0, attempts.length - MAX_ATTEMPTS),
      counters: phaseLedger === null ? null : {
        rejects: n0(phaseLedger.rejectCount),
        errors: n0(passLoop.errorCount),
        noProgress: n0(passLoop.noProgressCount),
        caps: n0(passLoop.capCount),
      },
      units: micro === null ? null : { total: n0(micro.unitCount), unresolved: n0(micro.unresolvedUnits), cycles: n0(micro.cyclesSpent) },
      usage: usageOf(sessions.filter((s) => s.phase === n)),
      current: current === n || endedIn === n,
    });
  }

  // Agents: the run's alive registry entries (pid verified), what the events say
  // is open, and the live dsh session of the current phase (model, step, last tool).
  const agents                                                 = [];
  const activity = chosen === null ? [] : openActivity(chosen);
  if (chosen !== null) {
    for (const entry of chosen.live) {
      const what = describeProcess(proc.cmdline(entry.pid));
      const role = what.role ?? ROLE_OF_KIND[entry.kind] ?? capText(entry.kind, 40);
      const open = activity.find((a) => a.role === role);
      const live = [...sessions]
        .filter((s) => s.role === role && (current === null || s.phase === current) && s.createdAt !== null && entry.startedAtMs !== null && Math.abs(s.createdAt - entry.startedAtMs) < 10_000)
        .pop();
      const parts = [open?.what, live === undefined ? null : `step ${live.steps}`, live?.lastTool === null || live === undefined ? null : `last tool ${live.lastTool}`, live?.lastAt == null ? null : `active ${isoOf(live.lastAt)}`];
      agents.push({
        role,
        what: capText(parts.filter((x) => x !== null && x !== undefined).join(" · ") || "running"),
        since: isoOf(entry.startedAtMs) ?? isoOf(open?.since ?? null),
        pid: entry.pid,
        alive: true,
        harness: what.harness,
        profile: what.profile,
        model: live?.model == null ? what.model : capText(live.provider === null ? live.model : `${live.provider}/${live.model}`, 80),
      });
    }
    for (const open of activity) {
      if (agents.some((a) => a.role === open.role)) continue;
      agents.push({
        role: open.role,
        what: capText(open.what),
        since: isoOf(open.since),
        pid: null,
        alive: run !== null && !run.ended ? null : false,
        harness: null,
        profile: null,
        model: open.model === null ? null : capText(open.model, 80),
      });
    }
  }
  const runLaunch = chosen === null ? null : launchOf(chosen);
  const launchRows = mine.map((l) => {
    const runOf = [...ts.runs].sort((a, b) => (b.firstAt ?? 0) - (a.firstAt ?? 0)).find((r) => launchOf(r)?.launchId === l.launchId);
    return {
      launch: l.launchId,
      reason: l.reason,
      state: l.state,
      at: isoOf(l.createdAt),
      endedAt: isoOf(l.endedAt),
      exit: l.signal !== null ? l.signal : l.exitReason !== null && l.exitReason !== undefined ? l.exitReason : l.exitCode === null ? null : `exit ${l.exitCode}`,
      run: runOf === undefined ? null : runOf.runId.slice(0, 12),
      current: runLaunch !== null && runLaunch.launchId === l.launchId,
    };
  });
  const usage = usageOf(sessions);
  const pauses = chosen === null ? 0 : chosen.events.filter((e) => e.type === "run.paused" || e.type === "yield.started").length;
  const limits = [
    usage === null ? null : usage.rateLimited > 0 ? `rate-limited ${usage.rateLimited}×` : "no rate limit hit",
    usage === null || usage.retries === 0 ? null : `${usage.retries} retries, ${Math.round(usage.backoffMs / 1000)} s backed off`,
    pauses > 0 ? `${pauses} limit pause(s) recorded` : "no limit pause recorded",
  ].filter((x) => x !== null).join("; ");
  const featureDetail                = {
    run: chosen === null ? null : {
      id: chosen.runId.slice(0, 40),
      launch: runLaunch?.launchId ?? null,
      state: run === null ? "unknown" : run.ended ? capText(run.outcome ?? "ended", 40) : chosen.live.length > 0 ? "running" : "between passes",
      phase: run?.currentPhase ?? null,
      startedAt: isoOf(chosen.firstAt),
      lastAt: isoOf(chosen.lastAt),
    },
    agents: agents.slice(0, MAX_AGENTS),
    agentsNote: run !== null && !run.ended ? "critic and verifier calls leave no live record in this engine; they show as the lane only" : null,
    launches: launchRows.slice(-MAX_LAUNCHES),
    launchesOmitted: Math.max(0, launchRows.length - MAX_LAUNCHES),
    log: logTail(fs, (runLaunch ?? mine[mine.length - 1])?.log ?? null, cwd, home),
    usage,
    cost: "not reported by dsh (tokens only)",
    limits: capText(limits),
    usageNote: sessions.length === 0 ? "no dsh session of this feature found" : "proposer, accelerator and worker calls; critic and diagnostician calls are not attributed",
  };
  const churn = [
    featureDetail.run, agents.map((a) => [a.role, a.pid, a.what]), launchRows.map((l) => [l.launch, l.state]),
    featureDetail.log.slice(-1), usage === null ? null : [usage.calls, usage.retries],
    [...phases.values()].map((p) => [p.tasksDone, p.attempts.map((a) => a.outcome + a.passes), p.counters, p.units]),
  ];
  return { phases, feature: featureDetail, churn };
}

const TEXT_CAP = 240;
const cap = (text        )         => {
  const bytes = Buffer.from(text, "utf8");
  return bytes.length <= TEXT_CAP ? text : `${bytes.subarray(0, TEXT_CAP - 3).toString("utf8").replace(/\uFFFD+$/, "")}...`;
};

/** The workspace a `.specstride/...` log path sits in, to make it relative. */
function cwdOfLog(path        )         {
  const at = path.indexOf("/.specstride/");
  return at < 0 ? "" : path.slice(0, at);
}

/** The one attention item of a feature whose latest run ended failed or blocked. */
function endedAttention(feature        , cards                          , run                                             )                       {
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
    need: cap(run.log ? `read ${safePath(run.log, cwdOfLog(run.log), homedir())}, fix the cause, then relaunch` : "read the run log, fix the cause, then relaunch"),
    next: "relaunch",
  };
}

function workspaceIdOf(fs        , cwd        )         {
  const raw = fs.read(join(cwd, ".specstride", "workspace.json"));
  if (raw !== null) {
    try {
      const id = (JSON.parse(raw)                             ).workspaceId;
      if (typeof id === "string" && id !== "") return id;
    } catch {
      // fall through to the path
    }
  }
  return createHash("sha256").update(cwd).digest("hex").slice(0, 32);
}

function tailText(text               )         {
  if (text === null) return "";
  if (text.length <= EVENTS_TAIL_BYTES) return text;
  const cut = text.slice(text.length - EVENTS_TAIL_BYTES);
  return cut.slice(cut.indexOf("\n") + 1);
}

/** The board of the workspace at `cwd`, or a `none` view when it holds no phased spec. */
export function readWorkspaceView(cwd        , fs         = nodeFs, now         = Date.now(), home         = homedir(), proc           = procPortOf(fs))                             {
  const eventsPath = join(cwd, ".specstride", "events.jsonl");
  const events = parseEvents(tailText(fs.read(eventsPath)));
  const workspaceId = workspaceIdOf(fs, cwd);
  const roots = controlRoots(workspaceId, home);
  const cards                  = [];
  const attention                  = [];
  let tsSize = 0;
  let tsCount = 0;
  const launches = readLaunches(fs, cwd, proc);
  const featureDetails                                = {};
  const churn            = [launches.map((l) => [l.launchId, l.state])];
  for (const feature of fs.list(join(cwd, "specs")).sort()) {
    const tasks = fs.read(join(cwd, "specs", feature, "tasks.md"));
    if (tasks === null) continue;
    const phases = parsePhases(tasks);
    if (phases.length === 0) continue;
    const gates = new Set        ();
    for (const name of fs.list(join(cwd, ".specstride", "features", feature, "gates"))) {
      const match = /^GATE(\d+)-APPROVED$/.exec(name);
      if (match !== null) gates.add(Number.parseInt(match[1]          , 10));
    }
    const ts = tsFeature(fs, cwd, roots, feature, new Set(phases.map((p) => p.title)), proc, launches, now);
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
    try {
      const built = buildDetails(fs, cwd, home, feature, tasks, ts, run, launches, proc);
      for (const card of mine) {
        const detail = card.phase === null ? undefined : built.phases.get(card.phase);
        if (detail !== undefined) card.detail = detail;
      }
      featureDetails[feature] = built.feature;
      churn.push(built.churn);
    } catch {
      // A detail that cannot be built leaves the card as it was (F121-FR-022).
    }
    cards.push(...mine);
    const item = run === null ? null : endedAttention(feature, mine, run);
    if (item !== null) attention.push(item);
  }
  const live = cards.some((c) => (c.lane === "proposing" || c.lane === "verifying" || c.lane === "reviewing") && c.flags.stale !== true);
  const state = cards.length === 0 ? "none" : live ? "running" : "idle";
  const lanes = WORKSPACE_LANES.map((lane) => ({ lane, cards: cards.filter((c) => c.lane === lane).map((c) => c.id) }));
  const signature = createHash("sha256")
    .update(JSON.stringify([cards.map((c) => [c.id, c.lane, c.flags.stale]), attention.map((a) => [a.key, a.oneLine]), churn]))
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
    featureDetails,
  };
}

/** The cursor token the route hands out for a reader view (matches the route's cursor pattern). */
export function readerCursor(view                                                                               )         {
  return `${view.cursor.offset}.${view.cursor.lastSeq}.${view.signature.token.slice(0, 8)}`;
}
