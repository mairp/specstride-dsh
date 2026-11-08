export function columnOf(card: { lane: string; ruleId: string }): string {
  return card.ruleId === "L-06" ? "blocked" : card.lane;
}
