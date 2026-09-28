import { describe, expect, it } from "vitest";
import {
  classifyBenchmarkArchetype,
  selectRepresentativeBenchmarks,
  toCommunityBenchmark,
  sampleBenchmarkCatalog,
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

  it("varies catalog samples by seed while reproducing the same seed", () => {
    const input = Array.from({ length: 40 }, (_, index) =>
      toCommunityBenchmark(deck(String(index), 3, [index % 2 ? "Aggro" : "Control"], 1000 - index)),
    );
    const a = sampleBenchmarkCatalog(input, 12, "seed-a").map((item) => item.id);
    const aAgain = sampleBenchmarkCatalog(input, 12, "seed-a").map((item) => item.id);
    const b = sampleBenchmarkCatalog(input, 12, "seed-b").map((item) => item.id);
    expect(aAgain).toEqual(a);
    expect(b).not.toEqual(a);
  });

  it("avoids recently faced decks when enough alternatives exist", () => {
    const input = Array.from({ length: 30 }, (_, index) =>
      toCommunityBenchmark(deck(String(index), 3, ["Value"], 1000 - index)),
    );
    const recent = input.slice(0, 10).map((item) => item.id);
    const sample = sampleBenchmarkCatalog(input, 10, "fresh", recent);
    expect(sample.every((item) => !recent.includes(item.id))).toBe(true);
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
