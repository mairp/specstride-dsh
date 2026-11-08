/** T032 — PT-121-013 (F121-FR-013; CT-121-02): characterization of the presentation
 * table and of Lisa's redundant encoding (Lisa `76adfdc`, `packages/web/src/theme/tokens.ts:160-180`,
 * read-only, never executed).
 *
 * Lisa keeps meaning off color alone: every state carries a GLYPH, a LABEL and a
 * GRAYSCALE, all three together and pairwise distinct. The feature's table keeps the
 * same shape over three closed sets (lanes, attention kinds, budget levels). The
 * table is the one in contracts/kanban-closed-sets.json (`proposedByFeature` rows
 * `kanban-lane-presentation`, `kanban-attention-presentation`,
 * `kanban-budget-presentation`); this test pins it with an inline snapshot and holds
 * the contract file equal to it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTENTION_KINDS, BUDGET_LEVELS, LANES } from "../../src/shared/generated/contract-values.ts";
import { acceptView, type ReadView } from "../../src/shared/view-read.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const contractPath = join(repoRoot, "contracts", "kanban-closed-sets.json");
const viewsDir = join(repoRoot, "packages", "dsh-kanban", "tests", "fixtures", "views");

type Entry = { glyph: string; label: string; grayscale: number };

/** Inline snapshot of the presentation table (F121-FR-013). Held equal to the contract. */
const TABLE: Record<string, { key: string; members: Record<string, Entry>; unknown: Entry }> = {
  "kanban-lane-presentation": {
    key: "lane",
    members: {
      queued: { glyph: "·", label: "Queued", grayscale: 232 },
      proposing: { glyph: "▶", label: "Proposing", grayscale: 160 },
      verifying: { glyph: "◇", label: "Verifying", grayscale: 184 },
      reviewing: { glyph: "◎", label: "Reviewing", grayscale: 136 },
      approved: { glyph: "✓", label: "Approved", grayscale: 88 },
      blocked: { glyph: "⏸", label: "Blocked", grayscale: 208 },
      paused: { glyph: "‖", label: "Paused", grayscale: 64 },
      failed: { glyph: "✗", label: "Failed", grayscale: 40 },
    },
    unknown: { glyph: "?", label: "the raw value, as text", grayscale: 112 },
  },
  "kanban-attention-presentation": {
    key: "kind",
    members: {
      "blocked-on-human": { glyph: "!", label: "Needs you", grayscale: 40 },
      "source-changed": { glyph: "△", label: "Source changed", grayscale: 88 },
      "dead-run": { glyph: "†", label: "Run is dead", grayscale: 16 },
      "launch-abandoned": { glyph: "⊘", label: "Launch abandoned", grayscale: 64 },
      "quota-pause": { glyph: "‖", label: "Paused for quota", grayscale: 136 },
      "budget-alert": { glyph: "$", label: "Budget alert", grayscale: 112 },
      "stale-run": { glyph: "⌛", label: "View is stale", grayscale: 160 },
      "orphan-processes": { glyph: "◌", label: "Orphan processes", grayscale: 208 },
      "unknown-state": { glyph: "⁇", label: "Unknown state", grayscale: 232 },
    },
    unknown: { glyph: "?", label: "the raw value, as text", grayscale: 184 },
  },
  "kanban-budget-presentation": {
    key: "level",
    members: {
      unknown: { glyph: "–", label: "Unknown", grayscale: 232 },
      ok: { glyph: "✓", label: "OK", grayscale: 200 },
      info: { glyph: "i", label: "Info", grayscale: 136 },
      warn: { glyph: "!", label: "Warn", grayscale: 104 },
      loud: { glyph: "‼", label: "Loud", grayscale: 72 },
      over: { glyph: "✗", label: "Over", grayscale: 40 },
    },
    unknown: { glyph: "?", label: "the raw value, as text", grayscale: 168 },
  },
};

const SETS: [string, string, readonly string[]][] = [
  ["kanban-lane-presentation", "lane", LANES],
  ["kanban-attention-presentation", "kind", ATTENTION_KINDS],
  ["kanban-budget-presentation", "level", BUDGET_LEVELS],
];

const readView = (name: string): ReadView => {
  const raw = JSON.parse(readFileSync(join(viewsDir, `${name}.json`), "utf8")) as unknown;
  const result = acceptView(raw);
  assert.ok(result.ok, `${name} is accepted`);
  return (result as { ok: true; view: ReadView }).view;
};

const index = JSON.parse(readFileSync(join(viewsDir, "index.json"), "utf8")) as {
  valid: string[];
  unknownMember: Record<string, { path: string | null }>;
};
const fixtures = index.valid;
// The unknown-member fixtures that acceptView accepts (path non-null); the
// schema-level refusals are not views and carry no badges.
const unknownFixtures = Object.entries(index.unknownMember)
  .filter(([, meta]) => meta.path !== null)
  .map(([name]) => name);

const checkDistinct = (id: string, entries: Entry[]): void => {
  for (const channel of ["glyph", "label", "grayscale"] as const) {
    const values = entries.map((e) => e[channel]);
    assert.equal(new Set(values).size, values.length, `${id}: ${channel} values pairwise distinct`);
  }
  const g = entries.map((e) => e.grayscale).sort((a, b) => a - b);
  for (const v of g) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${id}: grayscale ${v} is an integer in 0..255`);
  }
  for (let i = 1; i < g.length; i++) {
    assert.ok(g[i]! - g[i - 1]! >= 24, `${id}: grayscale ${g[i - 1]} and ${g[i]} differ by at least 24 (F121-FR-013)`);
  }
};

test("CT-121-02 (Lisa tokens.ts:152-163): Lisa's redundant encoding — every state carries glyph, label and grayscale, all pairwise distinct", () => {
  // Lisa `76adfdc`, packages/web/src/theme/tokens.ts, STATE_INDICATORS (read-only;
  // the values below are the characterized snapshot, never imported or executed).
  const lisa: Record<string, Entry> = {
    running: { glyph: "▶", label: "Running", grayscale: 150 },
    approved: { glyph: "✓", label: "Approved", grayscale: 110 },
    rejected: { glyph: "✗", label: "Rejected", grayscale: 70 },
    awaiting: { glyph: "⏸", label: "Awaiting human", grayscale: 190 },
    budget: { glyph: "$", label: "Budget exceeded", grayscale: 40 },
  };
  assert.deepEqual(Object.keys(lisa), ["running", "approved", "rejected", "awaiting", "budget"]);
  checkDistinct("Lisa STATE_INDICATORS", Object.values(lisa));
});

test("the table equals contracts/kanban-closed-sets.json — snapshot and contract file agree", () => {
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
    proposedByFeature: { id: string; members: Record<string, unknown>[]; unknown: Entry }[];
  };
  for (const [id, key, pinned] of SETS) {
    const row = contract.proposedByFeature.find((r) => r.id === id);
    assert.ok(row, `${id} is in the contract`);
    const members: Record<string, Entry> = {};
    for (const m of row.members) {
      members[(m as Record<string, string>)[key]] = {
        glyph: (m as Record<string, string>).glyph,
        label: (m as Record<string, string>).label,
        grayscale: (m as Record<string, number>).grayscale,
      };
    }
    assert.deepEqual({ key, members, unknown: row.unknown }, TABLE[id], `${id} equals the snapshot`);
    assert.deepEqual(Object.keys(members), [...pinned], `${id} keys equal the pinned set, in order`);
  }
});

for (const [id, key, pinned] of SETS) {
  test(`${id} is total over its generated set — one member per value of the pinned set, in order`, () => {
    assert.deepEqual(Object.keys(TABLE[id].members), [...pinned]);
  });

  test(`${id}: glyphs, labels and grayscales are pairwise distinct; grayscales (unknown included) differ by at least 24 (F121-FR-013)`, () => {
    const all = [...Object.values(TABLE[id].members), TABLE[id].unknown];
    checkDistinct(id, all);
  });

  test(`${id}: holds no key that is not a member and maps nothing to a lane`, () => {
    const laneNames = new Set<string>(LANES);
    for (const [k, entry] of Object.entries(TABLE[id].members)) {
      assert.ok((pinned as readonly string[]).includes(k), `key ${k} is a member of the set`);
      // The table maps a member to a presentation entry — never anything to a lane:
      // no entry carries a `lane` property and no glyph or label is a lane name.
      assert.ok(!("lane" in entry), `${id}/${k}: a presentation entry never carries a lane`);
      assert.ok(!laneNames.has(entry.glyph), `${id}/${k}: glyph is not a lane name`);
      assert.ok(!laneNames.has(entry.label), `${id}/${k}: label is not a lane name`);
    }
    assert.ok(!(pinned as readonly string[]).includes(TABLE[id].unknown.glyph), `${id}: the unknown glyph is not a member key`);
  });

  test(`${id}: every badge in every fixture carries all three channels together — known values hit the table, unknown values hit the unknown entry`, () => {
    for (const name of [...fixtures, ...unknownFixtures]) {
      const v = readView(name);
      if (id === "kanban-lane-presentation") {
        for (const card of v.cards) {
          const entry = TABLE[id].members[card.lane] ?? TABLE[id].unknown;
          assert.ok(entry.glyph.length > 0 && entry.label.length > 0 && Number.isInteger(entry.grayscale),
            `${name}: card ${card.id} (lane ${card.lane}) has glyph, label and grayscale`);
        }
      }
      if (id === "kanban-attention-presentation") {
        for (const row of v.attention) {
          const entry = TABLE[id].members[row.kind] ?? TABLE[id].unknown;
          assert.ok(entry.glyph.length > 0 && entry.label.length > 0 && Number.isInteger(entry.grayscale),
            `${name}: attention ${row.key} (kind ${row.kind}) has glyph, label and grayscale`);
        }
      }
      if (id === "kanban-budget-presentation") {
        for (const row of v.budget) {
          const entry = TABLE[id].members[row.level] ?? TABLE[id].unknown;
          assert.ok(entry.glyph.length > 0 && entry.label.length > 0 && Number.isInteger(entry.grayscale),
            `${name}: budget ${row.scope} (level ${row.level}) has glyph, label and grayscale`);
        }
      }
    }
  });
}

test("CT-121-02 (Lisa tokens.ts:160-180): the unknown entries carry the ? glyph with the raw value as text, all three channels", () => {
  for (const [id] of SETS) {
    const u = TABLE[id].unknown;
    assert.equal(u.glyph, "?", `${id}: unknown glyph is ?`);
    assert.equal(u.label, "the raw value, as text", `${id}: unknown label names the raw value`);
    assert.ok(Number.isInteger(u.grayscale), `${id}: unknown carries a grayscale too`);
  }
});

/* ------------------- the built tree carries the three channels ------------------- */

import { boardTree, DEFAULT_PREFIX, type Node as TreeNode } from "../../src/shared/board-tree.ts";
import { attentionPresentation, budgetPresentation, lanePresentation } from "../../src/shared/presentation.ts";

function flattenTree(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function badgesOfTree(node: TreeNode): TreeNode[] {
  return flattenTree(node).filter((n) => n.attrs["class"] === `${DEFAULT_PREFIX}-badge`);
}

const isDecimalGray = (value: string | undefined): boolean =>
  value !== undefined && /^[0-9]+$/.test(value) && Number(value) >= 0 && Number(value) <= 255;

/** Cross-check one badge against the table by its raw member value. */
const badgeMatches = (badge: TreeNode, entry: Entry, where: string): void => {
  assert.equal(badge.text, entry.glyph, `${where}: glyph is "${entry.glyph}"`);
  assert.equal(badge.attrs["aria-label"], entry.label, `${where}: aria-label is "${entry.label}"`);
  assert.equal(badge.attrs["data-gray"], String(entry.grayscale), `${where}: data-gray is ${entry.grayscale}`);
};

test("PT-121-013: every badge of every renderable fixture's built tree carries glyph, aria-label and data-gray together", () => {
  let badges = 0;
  for (const name of [...fixtures, ...unknownFixtures]) {
    const v = readView(name);
    const tree = boardTree(v);
    for (const badge of badgesOfTree(tree)) {
      assert.ok(badge.text !== undefined && badge.text.length > 0, `${name}: badge carries a glyph as its text`);
      assert.ok(badge.attrs["aria-label"] !== undefined && badge.attrs["aria-label"] !== "", `${name}: badge carries aria-label`);
      assert.ok(isDecimalGray(badge.attrs["data-gray"]), `${name}: badge carries data-gray as a decimal 0..255 (got ${badge.attrs["data-gray"]})`);
      badges += 1;
    }
  }
  assert.ok(badges >= 20, `checked ${badges} badges across the fixtures`);
});

test("PT-121-013: the built badges hit the table exactly — known members give the table's entry, unknown members the unknown entry", () => {
  for (const name of [...fixtures, ...unknownFixtures]) {
    const v = readView(name);
    const nodes = flattenTree(boardTree(v));
    for (const card of v.cards) {
      const cardNode = nodes.find((n) => n.attrs["data-card-id"] === card.id);
      assert.ok(cardNode, `${name}: card ${card.id} renders`);
      // The lane's badge lives on the card's column header (the card itself
      // carries its lane as data-lane); cross-check that header badge.
      const column = nodes.find(
        (n) => (n.attrs["data-lane"] === card.lane || (n.attrs["data-lanes"] ?? "").split(" ").includes(card.lane)),
      );
      assert.ok(column, `${name}: a column holds lane ${card.lane}`);
      const header = flattenTree(column!).find((n) => n.attrs["class"] === `${DEFAULT_PREFIX}-column-header`);
      badgeMatches(badgesOfTree(header!)[0]!, lanePresentation(card.lane), `${name} card ${card.id} (lane ${card.lane})`);
    }
    const section = nodes.find((n) => n.attrs["data-attention"] !== undefined);
    if (section && v.attention.length > 0) {
      const sectionNodes = flattenTree(section);
      for (const row of v.attention) {
        const rowNode = sectionNodes.find((n) => n.attrs["data-kind"] === row.kind);
        assert.ok(rowNode, `${name}: attention kind ${row.kind} renders`);
        badgeMatches(badgesOfTree(rowNode!)[0]!, attentionPresentation(row.kind), `${name} attention ${row.kind}`);
      }
    }
    const budget = nodes.find((n) => n.attrs["data-budget"] !== undefined);
    if (budget && v.budget.length > 0) {
      const budgetNodes = flattenTree(budget);
      for (const row of v.budget) {
        const rowNode = budgetNodes.find((n) => n.attrs["data-level"] === row.level);
        assert.ok(rowNode, `${name}: budget level ${row.level} renders`);
        badgeMatches(badgesOfTree(rowNode!)[0]!, budgetPresentation(row.level), `${name} budget ${row.level}`);
      }
    }
  }
});
