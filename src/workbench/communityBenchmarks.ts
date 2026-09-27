import type { ArchidektSearchResult } from "@/lib/archidekt";

export type BenchmarkArchetype =
  | "aggro"
  | "value"
  | "control"
  | "combo"
  | "graveyard"
  | "tokens"
  | "voltron"
  | "other";

export interface CommunityBenchmarkDeck extends ArchidektSearchResult {
  source: "archidekt";
  sourceUrl: string;
  archetype: BenchmarkArchetype;
}

const ARCHETYPE_TAGS: Array<[BenchmarkArchetype, string[]]> = [
  ["combo", ["combo", "storm", "doomsday"]],
  ["control", ["control", "counterspells", "stax", "prison", "pillow fort"]],
  ["graveyard", ["graveyard", "reanimator", "dredge", "self-mill"]],
  ["tokens", ["tokens", "go-wide", "populate"]],
  ["voltron", ["voltron", "equipment", "auras"]],
  ["aggro", ["aggro", "stompy", "weenies", "extra combats"]],
  ["value", ["value", "midrange", "blink", "etb effects", "good stuff"]],
];

export function classifyBenchmarkArchetype(tags: string[]): BenchmarkArchetype {
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  for (const [archetype, needles] of ARCHETYPE_TAGS) {
    if (needles.some((needle) => normalized.some((tag) => tag === needle || tag.includes(needle)))) {
      return archetype;
    }
  }
  return "other";
}

export function toCommunityBenchmark(deck: ArchidektSearchResult): CommunityBenchmarkDeck {
  return {
    ...deck,
    source: "archidekt",
    sourceUrl: `https://archidekt.com/decks/${encodeURIComponent(deck.id)}`,
    archetype: classifyBenchmarkArchetype(deck.tags),
  };
}

function stableScore(deck: CommunityBenchmarkDeck): number {
  // Popularity is a quality signal, but cap it so one viral list does not
  // dominate every benchmark suite.
  return Math.min(Math.log10(Math.max(1, deck.views ?? 1)), 6);
}

export function selectRepresentativeBenchmarks(
  decks: CommunityBenchmarkDeck[],
  count: number,
  bracket?: number,
): CommunityBenchmarkDeck[] {
  const eligible = decks
    .filter((deck) => !bracket || deck.bracket == null || deck.bracket === bracket)
    .sort((a, b) => stableScore(b) - stableScore(a) || a.id.localeCompare(b.id));
  const buckets = new Map<BenchmarkArchetype, CommunityBenchmarkDeck[]>();
  for (const deck of eligible) {
    buckets.set(deck.archetype, [...(buckets.get(deck.archetype) ?? []), deck]);
  }
  const order: BenchmarkArchetype[] = [
    "aggro",
    "value",
    "control",
    "combo",
    "graveyard",
    "tokens",
    "voltron",
    "other",
  ];
  const selected: CommunityBenchmarkDeck[] = [];
  let index = 0;
  while (selected.length < count) {
    let added = false;
    for (const archetype of order) {
      const deck = buckets.get(archetype)?.[index];
      if (!deck) continue;
      selected.push(deck);
      added = true;
      if (selected.length >= count) break;
    }
    if (!added) break;
    index += 1;
  }
  return selected;
}
