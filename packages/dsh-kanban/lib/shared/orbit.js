/**
 * T047 — the orbit projection (F121-FR-021; contracts/orbit.md). The same
 * columns the board shows, projected as rings: one ring per column that holds
 * cards, in board order (the engine's eight first, then unknown lanes as rim
 * rings), with deterministic golden-angle seeding (Lisa `galaxy.ts:228`,
 * 137.50776405003785°), exactly 240 relaxation iterations of same-ring
 * inverse-square repulsion (step 0.5°), and 3-decimal rounding (Lisa
 * `galaxy.ts:319-325`). No clock, no randomness, no input but the board model:
 * two calls on equal input serialize byte-equal (CT-121-05).
 *
 * Beside the figure goes a text readout that names every ring with its card
 * count and every card with its lane, in board order (CT-121-06) — the readout
 * is the accessible name of the figure, so no fact rides on the picture alone.
 *
 * Dropped from Lisa (owner-ruled, R10): mass, springs, critical path, clusters
 * — the view carries none of these and the plugin derives nothing.
 */
import { LANES } from "./generated/contract-values.js";
import { boardOf,                 } from "./board-model.js";
                                               

/** Lisa `galaxy.ts:228` — the golden angle in radians (137.50776405003785°). */
export const GOLDEN_ANGLE = 2.399963229728653;
/** Lisa `galaxy.ts` — the relaxation is iteration-bounded, not converged. */
export const ITERATIONS = 240;
/** The innermost ring and the ring gap (Lisa `galaxy.ts:42-51`). */
export const RING_BASE = 120;
export const RING_GAP = 90;
/** Each body moves along its ring by at most 0.5° per iteration. */
const STEP = 0.5 * (Math.PI / 180);
/** The chord below which two coincident bodies are pushed apart as if 1 apart. */
const MIN_CHORD = 1e-6;

                                                                               
                                                                                                                    
                                                                                                            

/** Lisa `galaxy.ts:319-325` — round onto the 3-decimal grid; a coordinate that would serialize with a leading `-0` (negative zero, or anything rounding strictly between -1 and 0) is written `0`. */
function round3(value        )         {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded > -1 && rounded <= 0 ? 0 : rounded;
}

/** One ring radius: the eight in LANES order, then the rim rings after them. */
function ringRadius(lane        , rimIndex        )         {
  const known = (LANES                     ).indexOf(lane);
  const index = known >= 0 ? known : (LANES                     ).length + rimIndex;
  return RING_BASE + index * RING_GAP;
}

const normalize = (angle        )         => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/**
 * The relaxation: each body moves along its own ring only, pushed by an
 * inverse-square repulsion from its nearest angular neighbours on that ring,
 * the per-iteration step clamped to 0.5°. Adjacent-neighbour repulsion keeps
 * the pass O(n) per iteration, so a 2,000-card ring stays bounded.
 */
function relax(angles          , radius        )       {
  const count = angles.length;
  if (count < 2) return;
  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const order = angles.map((angle, index) => ({ angle: normalize(angle), index })).sort((a, b) => a.angle - b.angle || a.index - b.index);
    const push = new Array        (count).fill(0);
    for (let slot = 0; slot < count; slot++) {
      const mine = order[slot]                                    ;
      const before = order[(slot - 1 + count) % count]                                    ;
      const after = order[(slot + 1) % count]                                    ;
      for (const other of [before, after]) {
        if (other.index === mine.index) continue;
        let delta = other.angle - mine.angle;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        const chord = Math.max(2 * radius * Math.sin(Math.abs(delta) / 2), MIN_CHORD);
        const force = 1 / (chord * chord);
        push[mine.index] += delta >= 0 ? -force : force;
      }
    }
    for (let index = 0; index < count; index++) {
      const move = Math.max(-STEP, Math.min(STEP, push[index]          ));
      angles[index] = (angles[index]          ) + move;
    }
  }
}

/** The orbit of a board model (or of the view the board is built from). */
export function orbitOf(input                       )        {
  const board             = "banners" in input ? (input              ) : boardOf(input            , { answer: "view" });

  const rings              = [];
  let rimIndex = 0;
  const bodies              = [];
  for (const column of board.columns) {
    if (column.cards.length === 0) continue; // a ring is a lane the board holds cards on
    const lane = column.lanes[0] ?? "";
    const radius = ringRadius(lane, rimIndex);
    if (!(LANES                     ).includes(lane)) rimIndex++;
    const angles = column.cards.map((_, index) => index * GOLDEN_ANGLE);
    relax(angles, radius);
    const cards = column.cards.map((card, index) => {
      const x = round3(Math.cos(angles[index]          ) * radius);
      const y = round3(Math.sin(angles[index]          ) * radius);
      return { cardId: card.id, lane, x, y };
    });
    rings.push({ lane, label: column.label, radius, count: cards.length, cards });
    bodies.push(...cards);
  }

  const lines           = [];
  for (const ring of rings) lines.push(`${ring.label}: ${ring.count} cards`);
  for (const ring of rings) {
    for (const card of ring.cards) lines.push(`${card.cardId} — ${ring.label}`);
  }
  return { rings, bodies, lines };
}
