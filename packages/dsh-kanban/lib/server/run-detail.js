/**
 * The card detail of the workspace reader (F121-FR-022 to F121-FR-024): what a
 * click on a phase card shows — the phase scope, the live agents, the attempt
 * and launch history, and cost/limits — built read-only from the files a
 * Specstride workspace already holds (the closed input list of F121-FR-023).
 *
 * Also the reconciliation of runs and launches: which engine run speaks for a
 * feature after a relaunch, and whether a recorded process is still alive.
 *
 * Every string is cut to 240 bytes with control characters stripped, every
 * list is bounded with an omitted count, and no absolute path leaves the
 * server: workspace paths become relative, the home directory becomes `~`
 * (F121-FR-024; engine 129 FR-009, FR-026, FR-033). No prompt body, no
 * signature, no key and no command line is ever copied into the view.
 */
import { join } from "node:path";
                                                            

/** The read-only file port of the reader (the same shape as `workspace-view.ts`'s). */
                        
                                   
                                        
                                    
                                 
  

/* ------------------------------------ bounds ------------------------------------ */

export const DETAIL_TEXT_CAP = 240;
export const MAX_TASKS = 60;
export const MAX_FILES = 12;
export const MAX_ATTEMPTS = 12;
export const MAX_LAUNCHES = 12;
export const MAX_AGENTS = 8;
export const MAX_LOG_LINES = 8;
/** A file read for the detail is skipped above this size (tasks.md has its own, larger bound). */
const JSON_READ_CAP = 256 * 1024;
const LOG_TAIL_BYTES = 16 * 1024;

const CONTROL = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g;

export function capText(text        , cap         = DETAIL_TEXT_CAP)         {
  const clean = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const bytes = Buffer.from(clean, "utf8");
  return bytes.length <= cap ? clean : `${bytes.subarray(0, cap - 3).toString("utf8").replace(/�+$/, "")}...`;
}

/** An absolute path made safe for the view: relative to the workspace, else `~`-rooted, else its base name. */
export function safePath(path        , cwd        , home        )         {
  if (path === cwd) return ".";
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (home !== "" && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  if (path.startsWith("/")) return path.split("/").pop() ?? path;
  return path;
}

function readJson(fs          , path        )                                 {
  if (fs.size(path) > JSON_READ_CAP) return null;
  const raw = fs.read(path);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw)           ;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value                           ) : null;
  } catch {
    return null;
  }
}

const str = (v         )                => (typeof v === "string" && v !== "" ? v : null);
const int = (v         )                =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : typeof v === "string" && /^\d+$/.test(v) ? Number.parseInt(v, 10) : null;
const iso = (ms               )                => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());

/* ---------------------------------- phase scope --------------------------------- */

                                                                                                                                     
                          
                      
                                 
                            
                    
                     
                     
                       
                  
                       
  

const SCOPE_PHASE = /^##[ \t]+Phase[ \t]+(\d+)[ \t]*[:.\-–—]?[ \t]*(.*)$/;
const SCOPE_TASK = /^[ \t]{0,3}[-*][ \t]+\[([ xX])\][ \t]+(T\d+[a-z]?)\b[ \t]*(.*)$/;
const SCOPE_FIELD = /^\*\*(Goal|Purpose|Independent Test|Checkpoint)\*\*[ \t]*:?[ \t]*(.*)$/i;
const SCOPE_PATH = /`([^`\s]+)`/g;
const LOOKS_LIKE_FILE = /^(?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,8}$|^(?:[\w.@-]+\/)+[\w.@-]*\/?$/;

                 
                 
                 
                            
                       
                                                                                                  
  

/** The scope of every phase of a tasks.md: goal, independent test, checkpoint, tasks and files. */
export function parseScopes(text        )                          {
  const phases             = [];
  let current                  = null;
  let field                  = null;
  let task                                   = null;
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const heading = SCOPE_PHASE.exec(line);
    if (heading !== null) {
      current = { number: Number.parseInt(heading[1]          , 10), goal: [], independentTest: [], checkpoint: [], tasks: [] };
      phases.push(current);
      field = null;
      task = null;
      continue;
    }
    if (/^##\s/.test(line)) {
      current = null;
      field = null;
      task = null;
      continue;
    }
    if (current === null) continue;
    if (/^###\s/.test(line)) {
      field = null;
      task = null;
      continue;
    }
    const f = SCOPE_FIELD.exec(line);
    if (f !== null) {
      const name = (f[1]          ).toLowerCase();
      field = name === "checkpoint" ? current.checkpoint : name === "independent test" ? current.independentTest : current.goal;
      if (name === "goal") current.goal.length = 0; // **Goal** wins over **Purpose**
      field.push(f[2] ?? "");
      task = null;
      continue;
    }
    const t = SCOPE_TASK.exec(line);
    if (t !== null) {
      let rest = t[3] ?? "";
      let parallel = false;
      let story                = null;
      for (;;) {
        const marker = /^\[([^\]]+)\][ \t]*/.exec(rest);
        if (marker === null) break;
        const name = marker[1]          ;
        if (name === "P") parallel = true;
        else if (/^US\d+$/.test(name)) story = name;
        rest = rest.slice(marker[0].length);
      }
      task = { id: t[2]          , text: [rest], done: t[1] !== " ", parallel, story };
      current.tasks.push(task);
      field = null;
      continue;
    }
    if (line.trim() === "") {
      field = null;
      continue;
    }
    if (task !== null && /^\s+\S/.test(line)) {
      task.text.push(line.trim().replace(/^[-*]\s+/, ""));
      continue;
    }
    if (field !== null && !/^\s*[-*]\s/.test(line)) {
      field.push(line.trim());
      continue;
    }
    task = null;
  }
  const out = new Map                    ();
  for (const phase of phases) {
    const files           = [];
    for (const t of phase.tasks) {
      for (const match of t.text.join(" ").matchAll(SCOPE_PATH)) {
        const token = (match[1]          ).replace(/[:,;]+$/, "");
        if (LOOKS_LIKE_FILE.test(token) && !files.includes(token)) files.push(token);
      }
    }
    const joined = (parts          )                => {
      const text = parts.join(" ").trim();
      return text === "" ? null : capText(text);
    };
    const tasks = phase.tasks.map((t) => ({
      id: t.id,
      text: capText(t.text[0] ?? "", 160),
      done: t.done,
      parallel: t.parallel,
      story: t.story,
      verdict: null,
    }));
    out.set(phase.number, {
      goal: joined(phase.goal) ?? (tasks[0] === undefined ? null : capText(tasks[0].text)),
      independentTest: joined(phase.independentTest),
      checkpoint: joined(phase.checkpoint),
      tasksDone: tasks.filter((t) => t.done).length,
      tasksTotal: tasks.length,
      tasks: tasks.slice(0, MAX_TASKS),
      tasksOmitted: Math.max(0, tasks.length - MAX_TASKS),
      files: files.slice(0, MAX_FILES).map((f) => capText(f, 160)),
      filesOmitted: Math.max(0, files.length - MAX_FILES),
    });
  }
  return out;
}

/** The per-task verdicts of the newest critic feedback of a phase (`T011: UNMET …`). */
export function feedbackVerdicts(fs          , featureDir        , phase        )                      {
  const verdicts = new Map                ();
  const candidates           = [];
  for (const dir of [join(featureDir, "feedback"), join(featureDir, "set-aside", `phase${phase}`)]) {
    for (const name of fs.list(dir)) {
      if (new RegExp(`^phase${phase}\\.(\\d+)\\.md$`).test(name)) candidates.push(join(dir, name));
    }
  }
  const newest = candidates.sort((a, b) => ordinalOf(a) - ordinalOf(b)).pop();
  if (newest === undefined || fs.size(newest) > JSON_READ_CAP) return verdicts;
  for (const line of (fs.read(newest) ?? "").split("\n")) {
    const m = /^(T\d+[a-z]?):\s*(MET|UNMET)\b/.exec(line.trim());
    if (m !== null) verdicts.set(m[1]          , m[2]          );
  }
  return verdicts;
}

function ordinalOf(path        )         {
  const m = /\.(\d+)\.md$/.exec(path);
  return m === null ? 0 : Number.parseInt(m[1]          , 10);
}

/* --------------------------------- process liveness ------------------------------ */

                        
                                                                   
                                       
                                                     
                                            
                                                                       
                              
                                            
                
  

export function procPortOf(fs          , root = "/proc")           {
  let boot                           ;
  return {
    stat: (pid) => fs.read(join(root, String(pid), "stat")),
    cmdline: (pid) => {
      const raw = fs.read(join(root, String(pid), "cmdline"));
      return raw === null ? null : raw.split("\0").filter((part) => part !== "");
    },
    bootMs: () => {
      if (boot !== undefined) return boot;
      const m = /^btime\s+(\d+)/m.exec(fs.read(join(root, "stat")) ?? "");
      boot = m === null ? null : Number.parseInt(m[1]          , 10) * 1000;
      return boot;
    },
    ticks: 100,
  };
}

/** The engine's own tolerance between a recorded and an observed process start (signal-owned.ts). */
export const START_TOLERANCE_MS = 1000;

/**
 * True when the process `pid` is alive AND is the one that was recorded: its
 * start time (boot time + field 22 of `/proc/<pid>/stat`) is within 1 s of
 * `startedAtMs`. A reused pid fails the check. Without a recorded start the
 * existence of the process is the answer.
 */
export function isAlive(proc          , pid               , startedAtMs               )          {
  if (pid === null || pid <= 0) return false;
  const stat = proc.stat(pid);
  if (stat === null) return false;
  const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (after[0] === "Z" || after[0] === "X") return false; // a zombie is not working
  if (startedAtMs === null) return true;
  const boot = proc.bootMs();
  const ticks = Number.parseInt(after[19] ?? "", 10);
  if (boot === null || !Number.isFinite(ticks)) return true;
  return Math.abs(boot + (ticks * 1000) / proc.ticks - startedAtMs) <= START_TOLERANCE_MS;
}

/** What a process is, from its command line — the role, harness, profile and model; never the prompt. */
export function describeProcess(argv                          )                                                                                                {
  if (argv === null || argv.length === 0) return { harness: null, profile: null, model: null, role: null };
  const base = (p        )         => p.split("/").pop() ?? p;
  let i = 0;
  if (/^node(js)?$|^bun$|^deno$/.test(base(argv[0]          )) && argv.length > 1) i = 1;
  const harness = base(argv[i]          ).replace(/\.(m?js|cjs)$/, "");
  let profile                = null;
  let model                = null;
  for (let k = i + 1; k < argv.length; k += 1) {
    const arg = argv[k]          ;
    const next = argv[k + 1];
    if ((arg === "--profile" || arg === "-p") && next !== undefined && !/\s/.test(next)) profile = next;
    else if ((arg === "--model" || arg === "-m") && next !== undefined && !/\s/.test(next)) model = next;
    else if (arg.startsWith("--model=")) model = arg.slice(8);
    else if (arg.startsWith("--profile=")) profile = arg.slice(10);
  }
  const text = argv.slice(i + 1).join(" ");
  let role                = null;
  if (/you are implementing phase|implement(ing)? phase \d+/i.test(text)) role = "proposer";
  else if (/\bcritic\b|\breview(er)? (the )?phase\b/i.test(text)) role = "critic";
  else if (/diagnos/i.test(text)) role = "diagnostician";
  else if (/accelerat/i.test(text)) role = "accelerator";
  return { harness: capText(harness, 40), profile: profile === null ? null : capText(profile, 60), model: model === null ? null : capText(model, 80), role };
}

/* ------------------------------------- runs ------------------------------------- */

                                                                                          

                         
                
                     
                         
                        
                 
                                                                     
                                                                    
  

                                                                                                 

/** The process registry of a control root (`procs.json`): `run:<runId>:<kind>` → identity. */
export function readProcRegistry(fs          , root        )              {
  const raw = readJson(fs, join(root, "procs.json"));
  if (raw === null) return [];
  const out              = [];
  for (const [key, value] of Object.entries(raw)) {
    const m = /^run:([\w.-]+):(.+)$/.exec(key);
    if (m === null || typeof value !== "object" || value === null) continue;
    const identity = (value                                          ).identity ?? {};
    const pid = int(identity.pid);
    if (pid === null) continue;
    out.push({ runId: m[1]          , kind: m[2]          , pid, startedAtMs: int(identity.startedAtMs) });
  }
  return out;
}

/**
 * The run that speaks for a feature (the reconciliation of F121-FR-023):
 *  1. a run with an ALIVE registry entry (pid verified against its recorded
 *     start) — the newest such by first event;
 *  2. else the newest run by first event;
 * among the runs that belong to the feature. `loop.json` is never consulted:
 * the engine writes it once and leaves it on every later run.
 */
export function pickRun(runs                      )                   {
  const byFirst = [...runs].sort((a, b) => (a.firstAt ?? 0) - (b.firstAt ?? 0));
  const alive = byFirst.filter((r) => r.live.length > 0);
  return alive.pop() ?? byFirst.pop() ?? null;
}

/* ----------------------------------- launches ----------------------------------- */

                            
                   
                         
                        
                           
                                                                                        
                
                          
                        
                         
                     
                         
                     
                                                                       
                             
  

/** Every launch of the workspace (`.specstride/launches/launch-*`), oldest first. */
export function readLaunches(fs          , cwd        , proc          )                 {
  const dir = join(cwd, ".specstride", "launches");
  const active = readJson(fs, join(cwd, ".specstride", "active"));
  const out                 = [];
  for (const name of fs.list(dir)) {
    if (!/^launch-[\w-]+$/.test(name)) continue;
    const launch = readJson(fs, join(dir, name, "launch.json"));
    if (launch === null) continue;
    const supervision = readJson(fs, join(dir, name, "supervision.json")) ?? {};
    const status = readJson(fs, join(dir, name, "runtime.status.json"));
    const request = (launch.request ?? {})                           ;
    const feature = str(supervision.pipeline) ?? str(request.pipeline);
    const createdAt = Date.parse(str(launch.createdAt) ?? "");
    let state        ;
    let exitCode                = null;
    let signal                = null;
    let endedAt                = null;
    // The pipeline's own record of the launch says how its stages ended; the
    // detached waiter's exit code alone does not (it exits 0 after a failed stage).
    const pipeline = feature === null ? null : readJson(fs, join(cwd, ".specstride", "state", "pipeline", feature, "runs", name, "state.json"));
    const pipelineState = str(pipeline?.state);
    const reason = str(pipeline?.exit_reason);
    if (status !== null) {
      exitCode = typeof status.exitCode === "number" ? status.exitCode : null;
      signal = str(status.signal);
      endedAt = int(status.endedAtMs);
      state = signal !== null ? "signalled" : pipelineState === "failed" || pipelineState === "completed" || pipelineState === "stopped" ? pipelineState : "exited";
    } else {
      // No exit record: alive only when its lease owner is verified alive.
      const lease = readJson(fs, join(cwd, ".specstride", "features", feature ?? "", "runs", `run-${name}`, "lease.json"));
      const owner = ((lease?.owner ?? (str(active?.launchId) === name ? active : null)) ?? null)                                  ;
      const alive = owner !== null && isAlive(proc, int(owner.pid), int(owner.startTime));
      state = alive ? "running" : "lost";
    }
    out.push({
      launchId: name,
      feature,
      reason: str(launch.reason),
      createdAt: Number.isFinite(createdAt) ? createdAt : null,
      state,
      exitCode,
      signal,
      endedAt,
      relaunches: Array.isArray(supervision.relaunches) ? supervision.relaunches.length : 0,
      stopRequested: supervision.stopRequested !== null && supervision.stopRequested !== undefined && supervision.stopRequested !== false,
      log: fs.exists(join(dir, name, "runtime.log")) ? join(dir, name, "runtime.log") : null,
      exitReason: reason === null ? null : capText(reason, 60),
    });
  }
  return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * The launch a run belongs to: the newest launch of the same feature created at
 * or before the run's first event, provided the run started before the next
 * launch did (the engine writes no id join; the launch → engine start gap is
 * well under a second). A run with no such launch was started by hand.
 */
export function launchOfRun(run           , launches                         )                      {
  // (see above) newest launch created at or before the run's first event, still running then
  if (run.firstAt === null) return null;
  let best                      = null;
  for (const launch of launches) {
    if (launch.createdAt === null || launch.createdAt > run.firstAt + START_TOLERANCE_MS) continue;
    if (best === null || launch.createdAt > (best.createdAt ?? 0)) best = launch;
  }
  if (best === null) return null;
  // A launch that had already ended when the run began did not start it.
  if (best.endedAt !== null && best.endedAt + START_TOLERANCE_MS < run.firstAt) return null;
  const next = launches.find((l) => l.createdAt !== null && l.createdAt > (best?.createdAt ?? 0));
  if (next !== undefined && next.createdAt !== null && run.firstAt > next.createdAt) return null;
  return best;
}

/** The last lines of a launch's runtime log, as text (paths made safe). */
export function logTail(fs          , path               , cwd        , home        )           {
  if (path === null) return [];
  const size = fs.size(path);
  const text = fs.read(path);
  if (text === null) return [];
  const tail = size > LOG_TAIL_BYTES ? text.slice(text.length - LOG_TAIL_BYTES) : text;
  const lines = tail.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.slice(-MAX_LOG_LINES).map((l) => capText(l.split(cwd).join(".").split(home).join("~")));
}

/* -------------------------------- the detail shape ------------------------------- */

export const shortRun = (id        )         => id.slice(0, 12);

/** The attempts of one phase across every run of the feature, oldest first. */
export function phaseAttempts(
  phase        ,
  runs                      ,
  launchOf                                         ,
  liveRunId               ,
)                  {
  const out                  = [];
  for (const run of [...runs].sort((a, b) => (a.firstAt ?? 0) - (b.firstAt ?? 0))) {
    let current                       = null;
    let inPhase = false;
    const close = (outcome        , at               )       => {
      if (current === null) return;
      current.outcome = outcome;
      current.endedAt = iso(at);
      out.push(current);
      current = null;
    };
    for (const e of run.events) {
      const p = int(e.data.phase);
      if (e.type === "phase.started") {
        if (inPhase && p !== phase) close("interrupted", e.at);
        inPhase = p === phase;
      }
      if (!inPhase) continue;
      switch (e.type) {
        case "attempt.started": {
          if (p !== phase) break;
          close("interrupted", e.at);
          current = {
            attempt: int(e.data.attempt) ?? out.length + 1,
            run: shortRun(run.runId),
            launch: launchOf(run)?.launchId ?? null,
            strategy: str(e.data.strategy),
            startedAt: iso(e.at),
            endedAt: null,
            outcome: "open",
            passes: 0,
            errors: 0,
          };
          break;
        }
        case "iter_start":
          if (current !== null) current.passes += 1;
          break;
        case "iter_error":
        case "iter_cap":
          if (current !== null) current.errors += 1;
          break;
        case "attempt.ended":
          if (p === phase) close("rejected", e.at);
          break;
        case "phase.ended":
          if (p === phase) {
            close(e.data.outcome === undefined || e.data.outcome === "approved" ? "approved" : capText(String(e.data.outcome), 40), e.at);
            inPhase = false;
          }
          break;
      }
    }
    if (current !== null) {
      const open = run.runId === liveRunId && run.live.length > 0;
      const c = current                 ;
      c.outcome = open ? "open" : run.ended ? "ended" : "interrupted";
      c.endedAt = open ? null : iso(run.lastAt);
      out.push(c);
    }
  }
  return out;
}

/** What is working right now in the live run (open passes, workers, diagnostician, accelerator, checks). */
export function openActivity(run           )                                                                               {
                                                                                         
  let pass              = null;
  let diagnostician              = null;
  let accelerator              = null;
  let check              = null;
  const workers = new Map              ();
  for (const e of run.events) {
    switch (e.type) {
      case "iter_start":
        pass = { role: "proposer", what: `pass ${int(e.data.iter) ?? "?"}/${int(e.data.max_iter) ?? "?"}`, since: e.at, model: null };
        break;
      case "iter_done":
      case "iter_error":
      case "iter_cap":
      case "attempt.ended":
      case "phase.ended":
        pass = null;
        if (e.type !== "iter_done" && e.type !== "iter_error") workers.clear();
        break;
      case "diagnostician_start":
        diagnostician = { role: "diagnostician", what: `phase ${int(e.data.phase) ?? "?"} attempt ${int(e.data.attempt) ?? "?"}`, since: e.at, model: str(e.data.provider) };
        break;
      case "diagnostician_done":
        diagnostician = null;
        break;
      case "accelerator_start":
        accelerator = { role: "accelerator", what: `phase ${int(e.data.phase) ?? "?"} attempt ${int(e.data.attempt) ?? "?"}`, since: e.at, model: str(e.data.backend) };
        break;
      case "acceleration_note":
        accelerator = null;
        break;
      case "parallel.worker.started": {
        const id = str(e.data.workerId) ?? "worker";
        workers.set(id, { role: "worker", what: `${id} on ${str(e.data.taskId) ?? "?"}`, since: e.at, model: null });
        break;
      }
      case "parallel.worker.ended":
        workers.delete(str(e.data.workerId) ?? "worker");
        break;
      case "parallel.group.ended":
        workers.clear();
        break;
      case "check.started":
        check = { role: "verifier", what: `check ${str(e.data.checkId) ?? ""}`.trim(), since: e.at, model: null };
        break;
      case "check.ended":
        check = null;
        break;
    }
  }
  return [pass, diagnostician, accelerator, check, ...workers.values()].filter((x)            => x !== null);
}
