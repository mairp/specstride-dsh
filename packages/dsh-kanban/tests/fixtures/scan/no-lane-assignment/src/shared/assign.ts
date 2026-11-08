export function place(card: { lane: string; phase: number }) {
  if (card.phase > 3) card.lane = "reviewing";
  return card;
}
