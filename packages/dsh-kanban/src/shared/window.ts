/**
 * T047 — the window of a lane (F121-FR-020; contracts/presentation.md, plan
 * §Performance Goals). Above the per-lane card threshold the board renders a
 * bounded window of card nodes — at most `threshold + 2 × overscan` — and the
 * client moves it on scroll; at or below the threshold every card is a node.
 *
 * `windowOf` is a pure function of the board model and the window options: it
 * returns a NEW `BoardModel` (never a mutation of its input) whose columns hold
 * the contiguous slice of cards around the scroll position, re-grouped by
 * feature. Everything else of the model — banners, attention, budget, no-run —
 * is carried over unchanged, so only the tree differs.
 *
 * Heights are in card rows: `scrollTop` is the first row at the top of the
 * viewport and `viewportHeight` is how many rows are visible. The card row is a
 * fixed height, so rows and pixels map 1:1.
 */
import type { BoardModel, BoardCard, CardGroup, ColumnModel } from "./board-model.ts";

export type WindowOptions = {
  scrollTop: number;
  viewportHeight: number;
  threshold?: number;
  overscan?: number;
};

/** The default per-lane threshold (F121-FR-20; contracts/presentation.md). */
export const DEFAULT_THRESHOLD = 100;
export const DEFAULT_OVERSCAN = 20;
/** The meta value must be plain decimal digits within 1..10,000. */
const THRESHOLD_PATTERN = /^[0-9]+$/;
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 10_000;

/**
 * The lane threshold from the view route's meta string. A value outside
 * 1..10,000 (or not plain decimal digits) falls back to 100 with exactly one
 * log line; a missing meta falls back silently.
 */
export function thresholdOfMeta(meta: string | null | undefined, log: (line: string) => void): number {
  if (meta === null || meta === undefined) return DEFAULT_THRESHOLD;
  if (!THRESHOLD_PATTERN.test(meta)) {
    log(`kanban: threshold meta ${JSON.stringify(meta)} is not a plain count — using ${DEFAULT_THRESHOLD}`);
    return DEFAULT_THRESHOLD;
  }
  const value = Number(meta);
  if (!Number.isInteger(value) || value < THRESHOLD_MIN || value > THRESHOLD_MAX) {
    log(`kanban: threshold meta ${JSON.stringify(meta)} is outside ${THRESHOLD_MIN}..${THRESHOLD_MAX} — using ${DEFAULT_THRESHOLD}`);
    return DEFAULT_THRESHOLD;
  }
  return value;
}

/**
 * The cards of one column inside the window, kept in COLUMN order (the
 * contiguous slice around the scroll position), grouped by feature as the
 * column already grouped them — each original group keeps its place and holds
 * the members the window covers, so the groups still partition the slice.
 */
function groupWithin(column: ColumnModel, start: number, end: number): CardGroup[] {
  const cards = column.cards;
  const sliced = cards.slice(Math.max(0, start), Math.max(0, end));
  const inWindow = new Set(sliced);
  const groups: CardGroup[] = [];
  for (const group of column.groups) {
    const kept = group.cards.filter((card) => inWindow.has(card));
    if (kept.length > 0) groups.push({ feature: group.feature, cards: kept });
  }
  return groups;
}

/**
 * The board as it renders at one scroll position: an equal-shape model whose
 * windowed columns hold at most `threshold + 2 × overscan` cards each. A column
 * at or below the threshold keeps every card. The input is never mutated.
 */
export function windowOf(board: BoardModel, options: WindowOptions): BoardModel {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const overscan = options.overscan ?? DEFAULT_OVERSCAN;
  const scrollTop = Math.max(0, Math.trunc(options.scrollTop));
  const viewportHeight = Math.max(0, Math.trunc(options.viewportHeight));
  let pruned = false;
  const columns: ColumnModel[] = board.columns.map((column) => {
    if (column.cards.length <= threshold) return column;
    pruned = true;
    const start = scrollTop - overscan;
    const end = scrollTop + viewportHeight + overscan;
    const groups = groupWithin(column, start, end);
    return { ...column, groups, cards: column.cards.slice(Math.max(0, start), Math.max(0, end)) };
  });
  return { ...board, columns, windowed: pruned };
}
