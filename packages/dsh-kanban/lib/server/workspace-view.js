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
import { join } from "node:path";
                                                                 

                      
                                              
                                   
                                        
                                        
                                   
                                    
                             
                                 
  

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
        lane = endLane(run.outcome);
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
export function readWorkspaceView(cwd        , fs         = nodeFs, now         = Date.now())                             {
  const eventsPath = join(cwd, ".specstride", "events.jsonl");
  const events = parseEvents(tailText(fs.read(eventsPath)));
  const cards                  = [];
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
    const run = latestRun(events, feature);
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
    cards.push(...featureCards(feature, phases, gates, run, now));
  }
  const live = cards.some((c) => (c.lane === "proposing" || c.lane === "verifying" || c.lane === "reviewing") && c.flags.stale !== true);
  const state = cards.length === 0 ? "none" : live ? "running" : "idle";
  const lanes = WORKSPACE_LANES.map((lane) => ({ lane, cards: cards.filter((c) => c.lane === lane).map((c) => c.id) }));
  const signature = createHash("sha256").update(JSON.stringify(cards.map((c) => [c.id, c.lane, c.flags.stale]))).digest("hex");
  const workspaceId = workspaceIdOf(fs, cwd);
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
    attention: [],
    attentionOmitted: 0,
    budget: [],
    budgetOmitted: 0,
    phases: [],
    cursor: { offset: fs.size(eventsPath), lastSeq: events.length },
    signature: { token: signature },
  };
}

/** The cursor token the route hands out for a reader view (matches the route's cursor pattern). */
export function readerCursor(view                                                                               )         {
  return `${view.cursor.offset}.${view.cursor.lastSeq}.${view.signature.token.slice(0, 8)}`;
}
