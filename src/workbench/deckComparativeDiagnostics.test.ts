import { describe, expect, it } from "vitest";
import { analyzeWorkbenchDeckTest } from "./deckDiagnostics";
import { summarizeWorkbenchDeckTest, type WorkbenchGameTelemetry } from "./deckTelemetry";

function game(index: number, won: boolean, missedLand: boolean): WorkbenchGameTelemetry {
  return {
    schemaVersion: 1, gameId: String(index), deckName: "Deck", playerId: "p0", completedAt: index,
    winnerId: won ? "p0" : "p1", won, engineTurn: 9, playerTurns: 7, snapshots: 20,
    openingHandSize: 7, openingLands: 3, lowestLife: 10, endingLife: won ? 20 : 0,
    maxLandsOnBattlefield: 7, landDropsMade: missedLand ? 5 : 6,
    missedLandDropTurns: missedLand ? [4] : [], landDropRate: missedLand ? 5/6 : 1,
    firstNonlandPermanentTurn: 2, firstCommanderCastTurn: 4, commanderCasts: 1,
    uniqueCardsSeen: 20, cardsDrawnApprox: 7, castEvents: 9, cardsCast: {}, stuckCards: [],
    mulliganPrompts: 1, paidAiCalls: 10, errors: 0, estimatedCostUsd: 0.1,
    commanderName: "Commander", commanderColors: ["B"], commanderColorsAvailableByTurn5: ["B"],
    missingCommanderColorsByTurn5: [], interactionCardsSeen: ["Removal"],
    earlyRampPermanentTurn: 2,
  };
}

describe("comparative deck diagnostics", () => {
  it("reports an outcome association only after both groups have useful samples", () => {
    const reports = [
      ...Array.from({ length: 6 }, (_, i) => game(i, false, true)),
      ...Array.from({ length: 6 }, (_, i) => game(i + 6, i < 4, false)),
    ];
    const diagnosis = analyzeWorkbenchDeckTest(reports, summarizeWorkbenchDeckTest(reports));
    const finding = diagnosis.deckFindings.find((item) => item.id === "impact:land-miss");
    expect(finding).toBeDefined();
    expect(finding?.confidence).toBe("medium");
    expect(finding?.evidence.join(" ")).toContain("association, not proof of causation");
  });

  it("does not manufacture a correlation from tiny groups", () => {
    const reports = [
      game(1, false, true),
      game(2, true, true),
      ...Array.from({ length: 10 }, (_, i) => game(i + 3, i < 3, false)),
    ];
    const diagnosis = analyzeWorkbenchDeckTest(reports, summarizeWorkbenchDeckTest(reports));
    expect(diagnosis.deckFindings.some((item) => item.id === "impact:land-miss")).toBe(false);
  });
});
