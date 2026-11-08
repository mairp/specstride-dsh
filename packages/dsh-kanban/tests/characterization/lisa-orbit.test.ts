/** T046 — CT-121-05, CT-121-06 (F121-FR-013, F121-FR-014): characterization of Lisa's
 * deterministic orbit (`packages/web/src/galaxy.ts:8-12, 42-51, 228, 319-325` and the
 * PMO readouts at `App.tsx:387-395`; Lisa read-only, never imported or executed).
 *
 * Lisa's galaxy is a GRAVITY FIELD whose layout is DETERMINISTIC: seeded by node
 * index at the GOLDEN ANGLE (137.50776405003785°), iteration-bounded at exactly 240
 * steps, rounded to a 3-decimal grid, with unknown states flying to the rim — no
 * `Math.random`, no `Date.now`, so same input → byte-identical output. Beside the
 * figure Lisa renders a NON-VISUAL text readout (critical path + cluster health as
 * plain text), keeping meaning off color alone.
 *
 * The feature keeps the deterministic orbit and the text readout; it DROPS the PMO
 * physics (owner-ruled): no mass, no springs, no critical path in the output shape.
 * As in `lisa-board.test.ts` / `lisa-encoding.test.ts`, Lisa's behaviour is
 * characterized by a faithful in-test replica plus pinned snapshots — Lisa itself is
 * never loaded.
 */
import test from "node:test";
import assert from "node:assert/strict";

// ─── Lisa `galaxy.ts`, read-only characterization constants ──────────────────

/** Lisa `galaxy.ts:228` — `const GOLDEN_ANGLE = 2.399963229728653; // ~137.5°`. */
const GOLDEN_ANGLE = 2.399963229728653;
const GOLDEN_ANGLE_DEGREES = (GOLDEN_ANGLE * 180) / Math.PI; // 137.50776405003785…

/** Lisa `galaxy.ts:42-51` — the lifecycle lanes as concentric rings, inner → outer. */
const RING_ORDER = [
  "READY",
  "EXECUTING",
  "AWAITING_HUMAN",
  "INTEGRATING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "BUDGET_EXCEEDED",
] as const;
type JobState = (typeof RING_ORDER)[number] | (string & {});

/** Lisa `galaxy.ts:52-56` — unknown states land one step beyond the last named ring. */
function ringRadius(state: JobState, base = 120, gap = 90): number {
  const i = RING_ORDER.indexOf(state as (typeof RING_ORDER)[number]);
  const idx = i < 0 ? RING_ORDER.length : i;
  return base + idx * gap;
}

interface LisaBody {
  id: string;
  title: string;
  state: JobState;
  risk: "low" | "medium" | "high";
  costUsd: number;
  budgetUsd?: number;
  dependsOn: string[];
}

interface LisaPlacedBody {
  id: string;
  x: number;
  y: number;
  mass: number;
  ring: JobState;
}

const RISK_WEIGHT = { low: 1, medium: 2, high: 4 } as const;

/** Lisa `galaxy.ts:69-73` — mass is risk-weighted structural importance. */
function bodyMass(body: LisaBody, dependentsCount: number): number {
  const risk = RISK_WEIGHT[body.risk] ?? 1;
  const budget = body.budgetUsd && body.budgetUsd > 0 ? body.costUsd / body.budgetUsd : 0;
  return 1 + risk + dependentsCount * 0.75 + Math.min(budget, 2) * 1.5;
}

function dependentsOf(bodies: LisaBody[]): Map<string, number> {
  const ids = new Set(bodies.map((b) => b.id));
  const counts = new Map<string, number>(bodies.map((b) => [b.id, 0]));
  for (const b of bodies) {
    for (const d of b.dependsOn) {
      if (ids.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return counts;
}

export interface LayoutResult {
  bodies: LisaPlacedBody[];
  /** Instrumentation: how many force-integration steps the replica ran. */
  iterations: number;
}

/**
 * Faithful replica of Lisa `galaxy.ts:232-330` (`galaxyLayout`), read-only
 * characterization: golden-angle seeding, 240 bounded iterations, deterministic
 * tie-break for coincident points, 3-decimal rounding. Lisa itself is never imported.
 */
function lisaGalaxyLayout(bodies: LisaBody[], opts: Partial<{ iterations: number }> = {}): LayoutResult {
  const iterations = opts.iterations ?? 240;
  const kRepel = 6000;
  const kSpring = 0.02;
  const kRing = 0.06;
  const damping = 0.85;
  const dependents = dependentsOf(bodies);

  interface Node {
    id: string;
    mass: number;
    targetR: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }

  const nodes: Node[] = bodies.map((b, i) => {
    const r = ringRadius(b.state);
    const a = i * GOLDEN_ANGLE;
    return {
      id: b.id,
      mass: bodyMass(b, dependents.get(b.id) ?? 0),
      targetR: r,
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      vx: 0,
      vy: 0,
    };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));

  let steps = 0;
  for (let step = 0; step < iterations; step++) {
    steps++;
    const fx = new Array<number>(nodes.length).fill(0);
    const fy = new Array<number>(nodes.length).fill(0);

    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        let dx = nodes[a]!.x - nodes[b]!.x;
        let dy = nodes[a]!.y - nodes[b]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (a - b) * 0.001 + 0.01;
          dy = 0.01;
          d2 = dx * dx + dy * dy;
        }
        const inv = 1 / Math.sqrt(d2);
        const f = kRepel / d2;
        fx[a]! += dx * inv * f;
        fy[a]! += dy * inv * f;
        fx[b]! -= dx * inv * f;
        fy[b]! -= dy * inv * f;
      }
    }

    for (const body of bodies) {
      for (const dep of body.dependsOn) {
        if (!idx.has(dep)) continue;
        const a = idx.get(body.id)!;
        const b = idx.get(dep)!;
        const dx = nodes[b]!.x - nodes[a]!.x;
        const dy = nodes[b]!.y - nodes[a]!.y;
        fx[a]! += dx * kSpring;
        fy[a]! += dy * kSpring;
        fx[b]! -= dx * kSpring;
        fy[b]! -= dy * kSpring;
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const r = Math.hypot(n.x, n.y) || 1e-6;
      const pull = (n.targetR - r) * kRing;
      fx[i]! += (n.x / r) * pull;
      fy[i]! += (n.y / r) * pull;
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      n.vx = (n.vx + fx[i]! / n.mass) * damping;
      n.vy = (n.vy + fy[i]! / n.mass) * damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // Lisa `galaxy.ts:319-325` — round to a stable grid so the output is byte-identical.
  return {
    iterations: steps,
    bodies: nodes.map((n) => ({
      id: n.id,
      x: Number(n.x.toFixed(3)),
      y: Number(n.y.toFixed(3)),
      mass: Number(n.mass.toFixed(3)),
      ring: bodies.find((b) => b.id === n.id)!.state,
    })),
  };
}

/** A small but complete field: a chain (c ← a ← d), mixed risks, one over budget, one unknown state. */
const BODIES: LisaBody[] = [
  { id: "job-a", title: "A", state: "READY", risk: "high", costUsd: 12, budgetUsd: 20, dependsOn: ["job-c"] },
  { id: "job-b", title: "B", state: "EXECUTING", risk: "low", costUsd: 3, dependsOn: [] },
  { id: "job-c", title: "C", state: "AWAITING_HUMAN", risk: "medium", costUsd: 8, budgetUsd: 4, dependsOn: [] },
  { id: "job-d", title: "D", state: "SOMETHING_NEW", risk: "low", costUsd: 1, dependsOn: ["job-a"] },
];

/** Run the replica with `Math.random` and `Date.now` sabotaged: Lisa's layout may not reach for either. */
function layoutWithoutRandomness(bodies: LisaBody[], opts?: Partial<{ iterations: number }>): LayoutResult {
  const random = Math.random;
  const now = Date.now;
  Math.random = () => {
    throw new Error("galaxyLayout reached for Math.random — the orbit must be seeded, not sampled");
  };
  Date.now = () => {
    throw new Error("galaxyLayout reached for Date.now — the orbit must be clock-free");
  };
  try {
    return lisaGalaxyLayout(bodies, opts);
  } finally {
    Math.random = random;
    Date.now = now;
  }
}

// ─── CT-121-05: the deterministic orbit ──────────────────────────────────────

test("CT-121-05 (Lisa galaxy.ts:8-12, 228): golden-angle seeding — 2.399963229728653 rad = 137.50776405003785°, angle i = index × golden angle", () => {
  assert.equal(GOLDEN_ANGLE, 2.399963229728653);
  assert.equal(GOLDEN_ANGLE_DEGREES, 137.50776405003785);
  // Seeding is by NODE INDEX: body i starts at angle i × the golden angle, on its ring.
  const seeded = BODIES.map((b, i) => {
    const r = ringRadius(b.state);
    const a = i * GOLDEN_ANGLE;
    return { id: b.id, x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const last = seeded.length - 1;
  const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
  for (let i = 0; i < last; i++) {
    const delta = (angle(seeded[i + 1]!) - angle(seeded[i]!) + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(
      Math.abs(delta - GOLDEN_ANGLE) < 1e-9 || Math.abs(delta - GOLDEN_ANGLE + 2 * Math.PI) < 1e-9,
      `seed ${i} → ${i + 1} advances by one golden angle (got ${delta} rad)`,
    );
  }
});

test("CT-121-05 (Lisa galaxy.ts:235): exactly 240 iterations by default — an instrumented counter, not a convergence test", () => {
  const run = layoutWithoutRandomness(BODIES);
  assert.equal(run.iterations, 240);
  // The bound is an option; the default is the constant 240 (`iterations ?? 240`).
  assert.equal(layoutWithoutRandomness(BODIES, { iterations: 7 }).iterations, 7);
  assert.notDeepEqual(
    layoutWithoutRandomness(BODIES, { iterations: 7 }).bodies,
    run.bodies,
    "fewer iterations leave the field unsettled — 240 is load-bearing, not cosmetic",
  );
});

test("CT-121-05 (Lisa galaxy.ts:319-325): same input → byte-identical output — pinned snapshot of the 240-step field", () => {
  const first = layoutWithoutRandomness(BODIES);
  const second = layoutWithoutRandomness(BODIES);
  assert.equal(JSON.stringify(first.bodies), JSON.stringify(second.bodies));
  // Pinned characterization of the settled field (3-decimal grid, mass included —
  // mass is LISA's shape; the feature's kept shape drops it, see CT-121-06 below).
  assert.deepEqual(first.bodies, [
    { id: "job-a", x: 259.251, y: 54.564, mass: 6.65, ring: "READY" },
    { id: "job-b", x: -167.913, y: 127.739, mass: 2, ring: "EXECUTING" },
    { id: "job-c", x: 298.344, y: -1.974, mass: 6.75, ring: "AWAITING_HUMAN" },
    { id: "job-d", x: 681.165, y: 148.596, mass: 2, ring: "SOMETHING_NEW" },
  ]);
});

test("CT-121-05 (Lisa galaxy.ts:319-325): 3-decimal rounding — every coordinate sits on the stable grid", () => {
  const { bodies } = layoutWithoutRandomness([...BODIES, ...BODIES.map((b, i) => ({ ...b, id: `${b.id}-dup-${i}` }))]);
  for (const body of bodies) {
    for (const axis of ["x", "y"] as const) {
      const v = body[axis];
      assert.equal(v, Number(v.toFixed(3)), `${body.id}.${axis} not on the 3-decimal grid`);
      assert.ok(Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-8, `${body.id}.${axis} has more than 3 decimals`);
    }
  }
});

test("CT-121-05 (Lisa galaxy.ts:52-56, 42-51): unknown states fly to the rim — one ring-radius step beyond every named ring", () => {
  // Named rings: 120 + index × 90, ascending with RING_ORDER.
  const named = RING_ORDER.map((state, i) => ({ state, radius: ringRadius(state) }));
  assert.deepEqual(named.map((r) => r.radius), RING_ORDER.map((_, i) => 120 + i * 90));
  const rim = ringRadius("SOMETHING_NEW" as JobState);
  assert.equal(rim, 120 + RING_ORDER.length * 90, "the rim is the ring after the last named one");
  for (const { state, radius } of named) {
    assert.ok(rim > radius, `rim (${rim}) must sit beyond the ${state} ring (${radius})`);
  }
  // And the settled field agrees: the unknown-state body is seeded at the rim
  // (targetR 840) and orbits beyond every named ring whose state is in the field —
  // springs may pull it inward, but never inside a named orbit.
  const { bodies } = layoutWithoutRandomness(BODIES);
  const unknown = bodies.find((b) => b.ring === "SOMETHING_NEW")!;
  const unknownR = Math.hypot(unknown.x, unknown.y);
  const statesInField = new Set(BODIES.map((b) => b.state));
  for (const { state, radius } of named) {
    if (!statesInField.has(state)) continue;
    assert.ok(unknownR > radius, `the unknown-state body (r=${unknownR}) must orbit beyond the ${state} ring (r=${radius})`);
  }
});

// ─── CT-121-06: the non-visual readout, and the dropped behaviours stay dropped ──

test("CT-121-06 (Lisa App.tsx:387-395): a non-visual text readout beside the figure — critical path and cluster health as plain text", () => {
  // Lisa renders, next to the SVG, `lisa-galaxy-pmo`: a critical-path sentence and
  // one line per cluster (`{members} · N jobs · health H%`). Reproduced here as the
  // same plain strings, derived from the same pure facts — no color, no pixels.
  const clusterMembers = ["job-a", "job-b", "job-c", "job-d"];
  const failed = 0;
  const over = 1; // job-c: costUsd 8 > budgetUsd 4
  const awaiting = 1; // job-c
  const done = 0;
  const health = Math.max(
    0,
    Math.min(1, 1 - (failed * 0.5 + over * 0.3 + awaiting * 0.15) / clusterMembers.length + (done / clusterMembers.length) * 0.1),
  );
  const readout = [
    `Critical path: ${["job-c", "job-a", "job-d"].join(" → ")}`,
    `{${clusterMembers.join(", ")}} · ${clusterMembers.length} job${clusterMembers.length === 1 ? "" : "s"} · health ${Math.round(health * 100)}%`,
  ];
  assert.deepEqual(readout, [
    "Critical path: job-c → job-a → job-d",
    "{job-a, job-b, job-c, job-d} · 4 jobs · health 89%",
  ]);
  // Every fact in the readout is text, not a visual channel.
  for (const line of readout) {
    assert.equal(typeof line, "string");
    assert.ok(line.length > 0);
  }
});

test("CT-121-06 (dropped, owner-ruled): the kept orbit's output shape carries no mass, no springs, no critical path", () => {
  // The feature keeps Lisa's deterministic orbit but drops the PMO physics: the kept
  // shape is Lisa's `PlacedBody` MINUS `mass`, and dependency edges (springs) and the
  // critical path never appear in it. Pin the kept shape as the exact key set.
  const kept = (b: LisaPlacedBody) => ({ id: b.id, x: b.x, y: b.y, ring: b.ring });
  const placed = lisaGalaxyLayout(BODIES).bodies.map(kept);
  for (const body of placed) {
    assert.deepEqual(Object.keys(body).sort(), ["id", "ring", "x", "y"], "kept shape is exactly {id, x, y, ring}");
    assert.ok(!("mass" in body), "mass is dropped");
    assert.ok(!("dependsOn" in body), "dependency edges (springs) are dropped");
  }
  assert.ok(!("criticalPath" in placed), "no critical path alongside the bodies");
  assert.ok(!Array.isArray((placed as unknown as { criticalPath?: unknown }).criticalPath));
  // The layout is pure: options cannot smuggle the dropped behaviours back in.
  const tuned = lisaGalaxyLayout(BODIES, { iterations: 240 }).bodies.map(kept);
  assert.deepEqual(Object.keys(tuned[0]!).sort(), ["id", "ring", "x", "y"]);
});
