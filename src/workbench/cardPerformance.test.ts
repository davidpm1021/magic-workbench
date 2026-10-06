import { describe, expect, it } from "vitest";
import { analyzeCardPerformance } from "./cardPerformance";
import type { WorkbenchGameTelemetry } from "./deckTelemetry";

function game(id: string, won: boolean, seen: string[], cast: Record<string, number>, stuck: string[]): WorkbenchGameTelemetry {
  return {
    schemaVersion: 1, gameId: id, deckName: "Deck", playerId: "player-0", completedAt: 1,
    winnerId: won ? "player-0" : "player-1", won, engineTurn: 8, playerTurns: 6, snapshots: 10,
    openingHandSize: 7, openingLands: 3, lowestLife: 10, endingLife: 10, maxLandsOnBattlefield: 6,
    landDropsMade: 6, missedLandDropTurns: [], landDropRate: 1, firstNonlandPermanentTurn: 2,
    firstCommanderCastTurn: 4, commanderCasts: 1, uniqueCardsSeen: seen.length,
    cardsDrawnApprox: 5, castEvents: Object.values(cast).reduce((a,b)=>a+b,0), cardsCast: cast,
    cardsSeen: seen, stuckCards: stuck.map((name) => ({ name, maxObservedTurnSpan: 4 })),
    mulliganPrompts: 1, paidAiCalls: 10, errors: 0, estimatedCostUsd: 0.1,
  };
}

describe("card performance", () => {
  it("aggregates seen, cast, stuck, and win observations without claiming causation", () => {
    const rows = analyzeCardPerformance([
      game("1", true, ["Sol Ring", "Big Spell"], { "Sol Ring": 1 }, ["Big Spell"]),
      game("2", false, ["Sol Ring"], { "Sol Ring": 1 }, []),
      game("3", false, ["Big Spell"], {}, ["Big Spell"]),
    ]);
    const ring = rows.find((row) => row.name === "Sol Ring")!;
    const big = rows.find((row) => row.name === "Big Spell")!;
    expect(ring.gamesSeen).toBe(2);
    expect(ring.gamesCast).toBe(2);
    expect(ring.seenWinRate).toBe(0.5);
    expect(big.gamesStuck).toBe(2);
    expect(big.gamesCast).toBe(0);
  });
});
