import { describe, expect, it } from "vitest";
import {
  classifyBenchmarkArchetype,
  selectRepresentativeBenchmarks,
  toCommunityBenchmark,
} from "./communityBenchmarks";
import type { ArchidektSearchResult } from "@/lib/archidekt";

function deck(id: string, bracket: number, tags: string[], views: number): ArchidektSearchResult {
  return {
    id,
    name: `Deck ${id}`,
    author: "brewer",
    format: "Commander / EDH",
    description: "",
    tags,
    bracket,
    views,
    cardCount: 100,
  };
}

describe("community benchmarks", () => {
  it("classifies common Commander archetypes", () => {
    expect(classifyBenchmarkArchetype(["Aristocrats", "Graveyard"])).toBe("graveyard");
    expect(classifyBenchmarkArchetype(["Equipment", "Commander Matters"])).toBe("voltron");
    expect(classifyBenchmarkArchetype(["Counterspells"])).toBe("control");
  });

  it("keeps source attribution", () => {
    const result = toCommunityBenchmark(deck("123", 3, ["Tokens"], 4000));
    expect(result.source).toBe("archidekt");
    expect(result.sourceUrl).toBe("https://archidekt.com/decks/123");
    expect(result.archetype).toBe("tokens");
  });

  it("builds a diverse deterministic suite at comparable bracket", () => {
    const input = [
      deck("a", 3, ["Aggro"], 9000),
      deck("b", 3, ["Control"], 8000),
      deck("c", 3, ["Combo"], 7000),
      deck("d", 3, ["Tokens"], 6000),
      deck("e", 4, ["Control"], 50000),
    ].map(toCommunityBenchmark);
    const first = selectRepresentativeBenchmarks(input, 4, 3);
    const second = selectRepresentativeBenchmarks(input, 4, 3);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first).toHaveLength(4);
    expect(first.every((item) => item.bracket === 3)).toBe(true);
    expect(new Set(first.map((item) => item.archetype)).size).toBe(4);
  });
});
