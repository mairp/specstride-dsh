/**
 * The card detail panel (F121-FR-022): a pure function of the selected card and
 * its feature's detail, in the same element tree as the board — every run text
 * enters as a `text` field, no handler and no markup rides in the tree, and
 * every state (task done, process alive, attempt outcome) carries glyph, label
 * and grayscale together (F121-FR-012, F121-FR-013). No clock: times are the
 * view's own ISO strings, shortened by slicing.
 *
 * Sections, in order: scope (goal, independent test, checkpoint, tasks, files),
 * live (run, agents, log tail), attempts (attempts, counters, units, approval,
 * evidence), launches, cost and limits.
 */
import { el, txt, type Node } from "./tree.ts";
import { aliveLabel, launchPresentation, outcomePresentation, taskPresentation, lanePresentation, type Presentation } from "./presentation.ts";
import type { DetailUsage, FeatureDetail, PhaseDetail, ViewCard } from "./view-read.ts";

/** `2026-11-09T01:49:05.570Z` → `11-09 01:49:05Z`; anything else unchanged. */
export function shortTime(iso: string | null): string {
  if (iso === null) return "—";
  const m = /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m === null ? iso : `${m[1]} ${m[2]}Z`;
}

/** 167694 → `167.7k`; 1534000 → `1.53M`. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function badge(prefix: string, p: Presentation): Node {
  return txt("span", { class: `${prefix}-badge`, "aria-label": p.label, "data-gray": String(p.grayscale) }, p.glyph);
}

function section(prefix: string, name: string, title: string, children: Node[]): Node {
  return el("section", { class: `${prefix}-detail-section`, "data-detail-section": name, "aria-label": title }, [
    txt("h4", { class: `${prefix}-detail-heading` }, title),
    ...children,
  ]);
}

function row(prefix: string, label: string, value: string): Node {
  return el("div", { class: `${prefix}-detail-row` }, [txt("span", { class: `${prefix}-detail-key` }, label), txt("span", { class: `${prefix}-detail-value` }, value)]);
}

function more(prefix: string, n: number, what: string): Node[] {
  return n > 0 ? [txt("div", { class: `${prefix}-detail-more` }, `and ${n} more ${what}`)] : [];
}

export function usageText(u: DetailUsage | null): string {
  if (u === null) return "none recorded";
  const parts = [
    `${u.sessions} session${u.sessions === 1 ? "" : "s"}`,
    `${u.calls} model call${u.calls === 1 ? "" : "s"}`,
    `${compact(u.tokensIn)} in / ${compact(u.tokensOut)} out tokens`,
  ];
  if (u.models.length > 0) parts.push(u.models.join(", "));
  return parts.join(" · ");
}

function scopeSection(prefix: string, d: PhaseDetail): Node {
  const children: Node[] = [];
  if (d.goal !== null) children.push(row(prefix, "Goal", d.goal));
  if (d.independentTest !== null) children.push(row(prefix, "Independent test", d.independentTest));
  if (d.checkpoint !== null) children.push(row(prefix, "Checkpoint", d.checkpoint));
  children.push(txt("div", { class: `${prefix}-detail-sub` }, `Tasks ${d.tasksDone}/${d.tasksTotal} done`));
  const items = d.tasks.map((t) => {
    const tags = [t.parallel ? "[P]" : null, t.story === null ? null : `[${t.story}]`].filter((x) => x !== null).join(" ");
    const parts: Node[] = [badge(prefix, taskPresentation(t.done ? "done" : "open")), txt("span", { class: `${prefix}-detail-id` }, t.id)];
    if (tags !== "") parts.push(txt("span", { class: `${prefix}-detail-tag` }, tags));
    parts.push(txt("span", {}, t.text));
    if (t.verdict !== null) parts.push(badge(prefix, taskPresentation(t.verdict === "MET" ? "met" : t.verdict === "UNMET" ? "unmet" : t.verdict)));
    return el("li", { class: `${prefix}-detail-task`, "data-task": t.id, "data-done": String(t.done) }, parts);
  });
  children.push(el("ul", { class: `${prefix}-detail-list`, "data-detail-tasks": "" }, items));
  children.push(...more(prefix, d.tasksOmitted, "tasks"));
  if (d.files.length > 0) {
    children.push(txt("div", { class: `${prefix}-detail-sub` }, "Files"));
    children.push(el("ul", { class: `${prefix}-detail-files` }, d.files.map((f) => txt("li", { class: `${prefix}-detail-file` }, f))));
    children.push(...more(prefix, d.filesOmitted, "files"));
  }
  return section(prefix, "scope", "Scope", children);
}

function liveSection(prefix: string, d: PhaseDetail, f: FeatureDetail | null): Node {
  const children: Node[] = [];
  if (f === null || f.run === null) {
    children.push(txt("div", { class: `${prefix}-detail-note` }, "No run recorded for this feature"));
    return section(prefix, "live", "Live", children);
  }
  const r = f.run;
  children.push(el("div", { class: `${prefix}-detail-row` }, [
    txt("span", { class: `${prefix}-detail-key` }, "Run"),
    el("span", { class: `${prefix}-detail-value ${prefix}-detail-chips` }, [
      txt("span", { class: `${prefix}-detail-mono`, title: r.id }, r.id),
      ...[r.launch ?? "started by hand", r.state, r.phase === null ? null : `phase ${r.phase}`]
        .filter((x): x is string => x !== null).map((fact) => txt("span", { class: `${prefix}-detail-chip` }, fact)),
    ]),
  ]));
  children.push(row(prefix, "Last event", shortTime(r.lastAt)));
  const live = r.state === "running" || r.state === "between passes";
  if (!d.current) {
    children.push(txt("div", { class: `${prefix}-detail-note` }, r.phase === null ? "This phase is not being worked on" : live ? `The run is on phase ${r.phase}, not this one` : `The run ended in phase ${r.phase}, not this one`));
  } else if (!live) {
    children.push(txt("div", { class: `${prefix}-detail-note` }, `The run ended in this phase (${r.state}); the agents below are its last ones`));
  }
  if (f.agents.length === 0) {
    children.push(txt("div", { class: `${prefix}-detail-note` }, "No agent process is alive"));
  } else {
    children.push(el("ul", { class: `${prefix}-detail-list`, "aria-live": "polite" }, f.agents.map((a) => {
      const alive = aliveLabel(a.alive);
      const facts = [a.what, a.model, a.harness === null ? null : `${a.harness}${a.profile === null ? "" : ` --profile ${a.profile}`}`, a.pid === null ? null : `pid ${a.pid}`, `since ${shortTime(a.since)}`]
        .filter((x) => x !== null && x !== "").join(" · ");
      return el("li", { class: `${prefix}-detail-agent`, "data-role": a.role, "data-alive": a.alive === null ? "unknown" : String(a.alive) }, [
        badge(prefix, alive),
        txt("span", { class: `${prefix}-detail-role` }, a.role),
        txt("span", {}, facts),
      ]);
    })));
  }
  if (f.agentsNote !== null) children.push(txt("div", { class: `${prefix}-detail-note` }, f.agentsNote));
  if (f.log.length > 0) {
    children.push(txt("div", { class: `${prefix}-detail-sub` }, "Launch log (last lines)"));
    children.push(el("ol", { class: `${prefix}-detail-log` }, f.log.map((l) => txt("li", {}, l))));
  }
  return section(prefix, "live", "Live", children);
}

function attemptsSection(prefix: string, d: PhaseDetail): Node {
  const children: Node[] = [];
  if (d.attempts.length === 0) children.push(txt("div", { class: `${prefix}-detail-note` }, "No attempt yet"));
  else {
    children.push(el("ol", { class: `${prefix}-detail-rows` }, d.attempts.map((a) => {
      const tail = [
        a.launch ?? "by hand",
        a.strategy,
        `${a.passes} pass${a.passes === 1 ? "" : "es"}`,
        a.errors > 0 ? `${a.errors} error${a.errors === 1 ? "" : "s"}` : null,
      ].filter((x) => x !== null).join(" · ");
      return el("li", { class: `${prefix}-detail-attempt`, "data-outcome": a.outcome }, [
        badge(prefix, outcomePresentation(a.outcome)),
        txt("span", { class: `${prefix}-detail-id` }, `attempt ${a.attempt}`),
        txt("span", { class: `${prefix}-detail-mono`, title: a.run }, a.run),
        txt("span", { class: `${prefix}-detail-tag` }, tail),
        txt("span", { class: `${prefix}-detail-when` }, `${shortTime(a.startedAt)} → ${a.endedAt === null ? "now" : shortTime(a.endedAt)}`),
      ]);
    })));
    children.push(...more(prefix, d.attemptsOmitted, "attempts"));
  }
  if (d.counters !== null) {
    const c = d.counters;
    children.push(row(prefix, "Counters", `${c.rejects} reject${c.rejects === 1 ? "" : "s"} · ${c.errors} pass error${c.errors === 1 ? "" : "s"} · ${c.noProgress} no-progress · ${c.caps} cap hit${c.caps === 1 ? "" : "s"}`));
  }
  if (d.units !== null) children.push(row(prefix, "Micro units", `${d.units.total} unit${d.units.total === 1 ? "" : "s"} · ${d.units.unresolved} unresolved · ${d.units.cycles} cycle${d.units.cycles === 1 ? "" : "s"}`));
  if (d.approval !== null) {
    const a = d.approval;
    children.push(row(prefix, "Approved", [shortTime(a.at), a.attempt === null ? null : `attempt ${a.attempt}`, a.critic === null ? null : `critic ${a.critic}`, a.commit === null ? null : `commit ${a.commit}`].filter((x) => x !== null).join(" · ")));
  }
  if (d.evidence !== null) children.push(row(prefix, "Evidence", `${d.evidence.name} (${compact(d.evidence.bytes)} bytes)`));
  return section(prefix, "attempts", "Attempts", children);
}

function launchesSection(prefix: string, f: FeatureDetail | null): Node | null {
  if (f === null || f.launches.length === 0) return null;
  const items = [...f.launches].reverse().map((l) => {
    const tail = [l.reason, l.state, l.exit, l.run === null ? "no engine run" : l.run, l.current ? "current" : null]
      .filter((x) => x !== null).join(" · ");
    return el("li", { class: `${prefix}-detail-launch`, "data-launch": l.launch, "data-state": l.state, ...(l.current ? { "aria-current": "true" } : {}) }, [
      badge(prefix, launchPresentation(l.state)),
      txt("span", { class: `${prefix}-detail-mono`, title: l.launch }, l.launch),
      txt("span", { class: `${prefix}-detail-tag` }, tail),
      txt("span", { class: `${prefix}-detail-when` }, `${shortTime(l.at)} → ${l.endedAt === null ? (l.state === "running" ? "now" : "?") : shortTime(l.endedAt)}`),
    ]);
  });
  return section(prefix, "launches", "Launches", [el("ol", { class: `${prefix}-detail-rows` }, items), ...more(prefix, f.launchesOmitted, "launches")]);
}

function costSection(prefix: string, d: PhaseDetail, f: FeatureDetail | null): Node {
  const children: Node[] = [row(prefix, "This phase", usageText(d.usage))];
  if (f !== null) {
    children.push(row(prefix, "Whole feature", usageText(f.usage)));
    children.push(row(prefix, "Cost", f.cost));
    children.push(row(prefix, "Limits", f.limits));
    if (f.usageNote !== null) children.push(txt("div", { class: `${prefix}-detail-note` }, f.usageNote));
  }
  return section(prefix, "cost", "Cost and limits", children);
}

/** The panel of one selected card; a card without detail gets the one "not available" line. */
export function detailTree(card: ViewCard, feature: FeatureDetail | null, prefix: string): Node {
  const title = typeof card.title === "string" && card.title !== "" ? card.title : card.id;
  const heading = card.phase === null ? title : `Phase ${card.phase} — ${title}`;
  const lane = lanePresentation(card.lane);
  const header = el("div", { class: `${prefix}-detail-header` }, [
    el("div", { class: `${prefix}-detail-meta` }, [
      el("span", { class: `${prefix}-detail-lane` }, [badge(prefix, lane), txt("span", {}, lane.label)]),
      txt("span", { class: `${prefix}-detail-feature` }, card.feature ?? "no feature"),
      txt("button", { type: "button", class: `${prefix}-detail-close`, "data-kanban-detail-close": "", "aria-label": "Close detail" }, "Close"),
    ]),
    txt("h3", { class: `${prefix}-detail-title`, tabindex: "-1", "data-detail-title": "" }, heading),
  ]);
  const d = card.detail;
  const body: Node[] = d === undefined
    ? [txt("div", { class: `${prefix}-detail-note` }, "No detail available for this card")]
    : [scopeSection(prefix, d), liveSection(prefix, d, feature), attemptsSection(prefix, d), ...[launchesSection(prefix, feature)].filter((x): x is Node => x !== null), costSection(prefix, d, feature)];
  return el("aside", {
    class: `${prefix}-detail`,
    "data-kanban-detail": card.id,
    "data-lane": card.lane,
    role: "region",
    "aria-label": `Detail of ${heading}`,
  }, [header, el("div", { class: `${prefix}-detail-body` }, body)]);
}
