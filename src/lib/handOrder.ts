import type { CardDto } from "@/protocol/game";
export type HandOrderMode = "manual" | "mana-value" | "mana-value-desc" | "name";
export const HAND_ORDER_OPTIONS: readonly {
  value: HandOrderMode;
  label: string;
}[] = [
  { value: "manual", label: "Default" },
  { value: "mana-value", label: "CMC ↑" },
  { value: "mana-value-desc", label: "CMC ↓" },
  { value: "name", label: "Name" },
];
export function reconcileHandOrder(order: readonly string[], cards: readonly CardDto[]): string[] {
  const present = new Set(cards.map((card) => card.id));
  const next = order.filter((id) => present.has(id));
  const known = new Set(next);
  for (const card of cards) {
    if (!known.has(card.id)) {
      known.add(card.id);
      next.push(card.id);
    }
  }
  return next;
}
export function orderHandCards(
  cards: readonly CardDto[],
  mode: HandOrderMode,
  manualOrder: readonly string[],
): CardDto[] {
  const order = reconcileHandOrder(manualOrder, cards);
  const indexById = new Map(order.map((id, index) => [id, index]));
  const sorted = [...cards];
  const stableIndex = (card: CardDto) => indexById.get(card.id) ?? sorted.length;
  if (mode === "manual") {
    sorted.sort((left, right) => stableIndex(left) - stableIndex(right));
  } else if (mode === "mana-value") {
    sorted.sort((left, right) => left.cmc - right.cmc || stableIndex(left) - stableIndex(right));
  } else if (mode === "mana-value-desc") {
    sorted.sort((left, right) => right.cmc - left.cmc || stableIndex(left) - stableIndex(right));
  } else {
    sorted.sort((left, right) =>
      left.name.localeCompare(right.name) || stableIndex(left) - stableIndex(right),
    );
  }
  return sorted;
}
export function nextHandOrderMode(mode: HandOrderMode): HandOrderMode {
  const index = HAND_ORDER_OPTIONS.findIndex((option) => option.value === mode);
  return HAND_ORDER_OPTIONS[(index + 1) % HAND_ORDER_OPTIONS.length]!.value;
}
