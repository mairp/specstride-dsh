/**
 * T035 — the presentation table (contracts/presentation.md "Styles";
 * F121-FR-013, F121-FR-014; CT-121-02, Lisa `tokens.ts:160-180`).
 *
 * One pure lookup per set, from the generated values of
 * `contracts/kanban-closed-sets.json` (T003/T005): every member of a set gets
 * the three channels that always travel together — a glyph, a label and a
 * grayscale value. Colour (chroma) carries no state alone: the grayscale is a
 * second channel, put on the badge as `data-gray` and given its own opacity
 * step by the build. The table maps members to presentation; it never maps
 * anything to a lane — lanes come from the view only (F121-FR-006).
 *
 * A member the table does not know (a newer engine) gets the glyph `?`, its
 * raw value as the label and its set's unknown grayscale — text, in place, and
 * the board does not stop (F121-FR-014).
 */
import {
  ATTENTION_PRESENTATION,
  ATTENTION_PRESENTATION_UNKNOWN,
  BUDGET_PRESENTATION,
  BUDGET_PRESENTATION_UNKNOWN,
  LANE_PRESENTATION,
  LANE_PRESENTATION_UNKNOWN,
} from "./generated/contract-values.js";

                                                                               

export const UNKNOWN_GLYPH = "?";

const LANES_TABLE = LANE_PRESENTATION                                          ;
const ATTENTION_TABLE = ATTENTION_PRESENTATION                                          ;
const BUDGET_TABLE = BUDGET_PRESENTATION                                          ;

/** The lane's presentation; an unknown lane keeps its raw value as the label. */
export function lanePresentation(lane        )               {
  const known = LANES_TABLE[lane];
  return known ?? { glyph: UNKNOWN_GLYPH, label: lane, grayscale: LANE_PRESENTATION_UNKNOWN.grayscale };
}

/** The attention kind's presentation; an unknown kind keeps its raw value as the label. */
export function attentionPresentation(kind        )               {
  const known = ATTENTION_TABLE[kind];
  return known ?? { glyph: UNKNOWN_GLYPH, label: kind, grayscale: ATTENTION_PRESENTATION_UNKNOWN.grayscale };
}

/** The budget level's presentation; an unknown level keeps its raw value as the label. */
export function budgetPresentation(level        )               {
  const known = BUDGET_TABLE[level];
  return known ?? { glyph: UNKNOWN_GLYPH, label: level, grayscale: BUDGET_PRESENTATION_UNKNOWN.grayscale };
}

/* ------------------------- card detail sets (F121-FR-022, F121-FR-024) ------------------------- */

/**
 * The plugin-local presentation of the detail panel's states: a task's tick and
 * critic verdict, a process's liveness, an attempt's or launch's outcome. Same
 * three channels as the closed sets above, pairwise distinct glyph, label and
 * grayscale (at least 24 apart within a set); an unknown member keeps its raw
 * value as the label and the glyph `?`.
 */
export const TASK_PRESENTATION                                         = {
  done: { glyph: "✓", label: "done", grayscale: 232 },
  met: { glyph: "◆", label: "critic: met", grayscale: 200 },
  open: { glyph: "○", label: "open", grayscale: 160 },
  unmet: { glyph: "✗", label: "critic: unmet", grayscale: 112 },
};
export const TASK_PRESENTATION_UNKNOWN               = { glyph: UNKNOWN_GLYPH, label: "unknown", grayscale: 88 };

export const ALIVE_PRESENTATION                                         = {
  alive: { glyph: "●", label: "alive", grayscale: 232 },
  unknown: { glyph: "◌", label: "not observable", grayscale: 176 },
  gone: { glyph: "○", label: "gone", grayscale: 120 },
};

export const OUTCOME_PRESENTATION                                         = {
  approved: { glyph: "✓", label: "approved", grayscale: 232 },
  open: { glyph: "▶", label: "in progress", grayscale: 184 },
  rejected: { glyph: "✗", label: "rejected", grayscale: 136 },
  ended: { glyph: "■", label: "ended", grayscale: 112 },
  interrupted: { glyph: "‖", label: "interrupted", grayscale: 88 },
};
export const OUTCOME_PRESENTATION_UNKNOWN               = { glyph: UNKNOWN_GLYPH, label: "unknown", grayscale: 64 };

export const LAUNCH_PRESENTATION                                         = {
  running: { glyph: "▶", label: "running", grayscale: 208 },
  completed: { glyph: "✓", label: "completed", grayscale: 184 },
  exited: { glyph: "■", label: "exited", grayscale: 160 },
  stopped: { glyph: "⏸", label: "stopped", grayscale: 136 },
  signalled: { glyph: "‖", label: "stopped by a signal", grayscale: 112 },
  failed: { glyph: "✗", label: "failed", grayscale: 88 },
  lost: { glyph: "⚠", label: "lost (no exit record)", grayscale: 64 },
};
export const LAUNCH_PRESENTATION_UNKNOWN               = { glyph: UNKNOWN_GLYPH, label: "unknown", grayscale: 232 };

/** Every detail set with its unknown member, for the build's grayscale rules and the distinctness test. */
export const DETAIL_SETS                                                                                                       = {
  task: { members: TASK_PRESENTATION, unknown: TASK_PRESENTATION_UNKNOWN },
  alive: { members: ALIVE_PRESENTATION, unknown: { glyph: UNKNOWN_GLYPH, label: "unknown", grayscale: 64 } },
  outcome: { members: OUTCOME_PRESENTATION, unknown: OUTCOME_PRESENTATION_UNKNOWN },
  launch: { members: LAUNCH_PRESENTATION, unknown: LAUNCH_PRESENTATION_UNKNOWN },
};

const lookup = (set                          , member        )               => {
  const s = DETAIL_SETS[set]                                                                              ;
  return s.members[member] ?? { glyph: UNKNOWN_GLYPH, label: member, grayscale: s.unknown.grayscale };
};

export function taskPresentation(member        )               {
  return lookup("task", member);
}
export function outcomePresentation(member        )               {
  return lookup("outcome", member);
}
export function launchPresentation(member        )               {
  return lookup("launch", member);
}
/** A process's liveness: true → alive, false → gone, null → not observable. */
export function aliveLabel(alive                )               {
  return lookup("alive", alive === null ? "unknown" : alive ? "alive" : "gone");
}
