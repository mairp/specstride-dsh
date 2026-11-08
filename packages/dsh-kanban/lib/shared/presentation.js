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
