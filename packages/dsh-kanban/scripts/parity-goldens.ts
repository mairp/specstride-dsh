/**
 * T051 — the golden-view parity wiring for U-9 (F121-SC-001, second half;
 * research.md R3). Given a directory of `specstride.view/1` JSON files, this
 * script runs the assertions of T012 (tests/parity/board-equals-view.test.ts)
 * on each file and prints one line per file:
 *
 *     <name>: ok
 *     <name>: N finding(s): ...
 *
 * It exits 0 when every file passed and 1 otherwise. Files it cannot accept
 * (`acceptView` refuses) are reported per file, never crash the run. Running
 * it on the engine's golden views is a person's step once U-9 ships them;
 * this script neither fetches them nor copies them — it only reads the
 * directory it is given. No model call, no network, no file write.
 *
 * Usage: node --experimental-strip-types packages/dsh-kanban/scripts/parity-goldens.ts <dir>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptView, type ReadView } from "../src/shared/view-read.ts";
import { LANES } from "../src/shared/generated/contract-values.ts";
import { buildBoard, buildColumns } from "../src/shared/board-model.ts";

export type ParityResult = { name: string; ok: boolean; findings: readonly string[] };

/** The (cardId, lane, ruleId) triple of one view card, as T012 compares it. */
type Triple = readonly [string, string, string];

/** The T012 assertions over one accepted view; empty findings means parity. */
export function parityFindings(view: ReadView): readonly string[] {
  const findings: string[] = [];
  const known = new Set<string>(LANES);

  // 1. The columns: the eight lanes in order, empty ones included, then one
  //    trailing column per unknown lane in first-appearance order.
  const columns = buildColumns(view);
  if (columns.length < LANES.length) {
    findings.push(`only ${columns.length} column(s), expected at least ${LANES.length}`);
  } else {
    const leading = columns.slice(0, LANES.length).map((column) => column.lane);
    if (leading.join(",") !== [...LANES].join(",")) {
      findings.push(`the eight leading lanes are ${leading.join(",")}, expected ${[...LANES].join(",")}`);
    }
    const expectedUnknown = [
      ...new Set(view.cards.map((card) => card.lane).filter((lane) => !known.has(lane))),
    ];
    const trailing = columns.slice(LANES.length).map((column) => column.lane);
    if (trailing.join(",") !== expectedUnknown.join(",")) {
      findings.push(
        `trailing columns ${trailing.join(",")} !== unknown lanes ${expectedUnknown.join(",")} (first-appearance order)`,
      );
    }
  }

  // 2. The card set: each view card exactly once, with its own lane and ruleId.
  const board = buildBoard(view);
  const onBoard: Triple[] = board.columns.flatMap((column) =>
    column.groups.flatMap((group) =>
      group.cards.map((card) => [card.cardId, card.lane, card.ruleId] as Triple),
    ),
  );
  const inView: Triple[] = view.cards.map((card) => [card.id, card.lane, card.ruleId]);
  if (onBoard.length !== inView.length) {
    findings.push(`${onBoard.length} card(s) on the board, ${inView.length} in the view`);
  }
  const sameSet =
    [...onBoard].sort().join("|") === [...inView].sort().join("|");
  if (!sameSet) {
    const onlyView = inView.filter((triple) => !onBoard.some((other) => other.join(",") === triple.join(",")));
    const onlyBoard = onBoard.filter((triple) => !inView.some((other) => other.join(",") === triple.join(",")));
    if (onlyView.length > 0) findings.push(`missing from the board: ${onlyView.map((t) => t.join(",")).join("; ")}`);
    if (onlyBoard.length > 0) findings.push(`on the board but not the view: ${onlyBoard.map((t) => t.join(",")).join("; ")}`);
  }

  // 3. The order: inside each column, view order regrouped by feature —
  //    first appearance first, the null-feature group last.
  const byId = new Map(view.cards.map((card) => [card.id, card]));
  for (const column of board.columns) {
    // A known lane follows its view.lanes row; a trailing unknown lane has no
    // row — its order is the cards' first-appearance order in view.cards.
    const laneOrder =
      view.lanes.find((lane) => lane.lane === column.lane)?.cards ??
      view.cards.filter((card) => card.lane === column.lane).map((card) => card.id);
    const firstAppearance: (string | null)[] = [];
    const byFeature = new Map<string | null, string[]>();
    for (const id of laneOrder) {
      const feature = byId.get(id)?.feature ?? null;
      if (!byFeature.has(feature)) {
        byFeature.set(feature, []);
        if (feature !== null) firstAppearance.push(feature);
      }
      (byFeature.get(feature) as string[]).push(id);
    }
    const expected: string[] = [
      ...firstAppearance.map((feature) => byFeature.get(feature) as string[]),
      ...(byFeature.has(null) ? [byFeature.get(null) as string[]] : []),
    ].flat();
    const actual = column.groups.flatMap((group) => group.cards.map((card) => card.cardId));
    if (actual.join(",") !== expected.join(",")) {
      findings.push(
        `lane ${String(column.lane)}: card order ${actual.join(",")} !== ${expected.join(",")}`,
      );
    }
  }
  return findings;
}

/** Run the parity over every `*.json` view file of a directory (index.json excluded). */
export function runParity(directory: string): readonly ParityResult[] {
  const results: ParityResult[] = [];
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".json") || entry === "index.json") continue;
    const name = entry.slice(0, -".json".length);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(directory, entry), "utf8"));
    } catch (error) {
      results.push({ name, ok: false, findings: [`unreadable: ${(error as Error).message}`] });
      continue;
    }
    const accepted = acceptView(raw);
    if (!accepted.ok) {
      results.push({ name, ok: false, findings: [`refused: ${accepted.line}`] });
      continue;
    }
    const findings = parityFindings(accepted.view);
    results.push({ name, ok: findings.length === 0, findings });
  }
  return results;
}

/** One line per file, then a summary; exit 1 when any file failed. */
function main(argv: readonly string[]): number {
  const directory = argv[0];
  if (!directory) {
    console.error("usage: parity-goldens.ts <dir-of-specstride.view/1-json>");
    return 2;
  }
  const results = runParity(directory);
  if (results.length === 0) {
    console.error(`no view file found in ${directory}`);
    return 2;
  }
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`${result.name}: ok`);
    } else {
      failed += 1;
      console.log(`${result.name}: ${result.findings.length} finding(s): ${result.findings.join(" | ")}`);
    }
  }
  console.log(`parity: ${results.length - failed}/${results.length} golden view(s) equal to the board (F121-SC-001)`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
