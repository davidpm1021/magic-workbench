import { fetchArchidektDeck } from "@/lib/archidekt";
import { resolveDeckTextImport } from "@/components/editor/useDeckTextImport";
import type { Deck } from "@/protocol/deck";
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

export interface LoadedCommunityBenchmark {
  benchmark: CommunityBenchmarkDeck;
  deck: Deck;
}

export interface SkippedCommunityBenchmark {
  benchmark: CommunityBenchmarkDeck;
  reason: string;
}

export async function loadPlayableCommunityBenchmarks(
  candidates: CommunityBenchmarkDeck[],
  count: number,
  onSkip?: (skipped: SkippedCommunityBenchmark) => void,
): Promise<LoadedCommunityBenchmark[]> {
  const loaded: LoadedCommunityBenchmark[] = [];
  // Resolve sequentially on purpose. A benchmark refresh should be gentle to
  // Archidekt/Scryfall and does not need a burst of dozens of deck requests.
  for (const benchmark of candidates) {
    if (loaded.length >= count) break;
    try {
      loaded.push({ benchmark, deck: await loadCommunityBenchmarkDeck(benchmark) });
    } catch (error) {
      onSkip?.({
        benchmark,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return loaded;
}

export async function loadCommunityBenchmarkDeck(
  benchmark: CommunityBenchmarkDeck,
): Promise<Deck> {
  const source = await fetchArchidektDeck(benchmark.id);
  const entries = [
    ...source.commanders.map((card) => ({
      name: card.name,
      count: card.count,
      commander: true,
      side: false,
      maybe: false,
      setCode: card.set,
      collectorNumber: card.cardNumber,
    })),
    ...source.cards.map((card) => ({
      name: card.name,
      count: card.count,
      commander: false,
      side: false,
      maybe: false,
      setCode: card.set,
      collectorNumber: card.cardNumber,
    })),
  ];
  const resolved = await resolveDeckTextImport(entries, () => {});
  const cardCount = resolved.cards.length + resolved.commanders.length;
  if (resolved.notFound.length > 0 || cardCount !== 100 || resolved.commanders.length === 0) {
    const details = [
      `${cardCount}/100 playable cards`,
      `${resolved.commanders.length} commander(s)`,
      resolved.notFound.length > 0 ? `${resolved.notFound.length} unresolved card(s): ${resolved.notFound.slice(0, 3).join(", ")}` : null,
      resolved.ignoredNonDeckCards.length > 0 ? `${resolved.ignoredNonDeckCards.length} token/non-deck card(s) ignored` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`Benchmark "${benchmark.name}" failed validation: ${details}.`);
  }
  return {
    id: `archidekt:${benchmark.id}`,
    name: benchmark.name,
    format: "commander",
    cards: resolved.cards,
    sideboard: resolved.sideboard,
    commanders: resolved.commanders,
    maybeboard: [],
    attractions: [],
    contraptions: [],
    schemes: [],
    planes: [],
  };
}
