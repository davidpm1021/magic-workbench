import { describe, expect, it } from "vitest";
import { analyzeWorkbenchDeckTest } from "./deckDiagnostics";
import { summarizeWorkbenchDeckTest, type WorkbenchGameTelemetry } from "./deckTelemetry";

function report(index: number, won: boolean, archetypes: string[]): WorkbenchGameTelemetry {
  return {
    schemaVersion: 1,
    gameId: `g${index}`,
    deckName: "Test Deck",
    playerId: "player-0",
    completedAt: index,
    winnerId: won ? "player-0" : "player-1",
    won,
    engineTurn: 8,
    playerTurns: 7,
    snapshots: 20,
    openingHandSize: 7,
    openingLands: 3,
    lowestLife: 10,
    endingLife: won ? 20 : 0,
    maxLandsOnBattlefield: 7,
    landDropsMade: 6,
    missedLandDropTurns: [],
    landDropRate: 1,
    firstNonlandPermanentTurn: 2,
    firstCommanderCastTurn: 4,
    commanderCasts: 1,
    uniqueCardsSeen: 20,
    cardsDrawnApprox: 8,
    castEvents: 10,
    cardsCast: {},
    stuckCards: [],
    mulliganPrompts: 1,
    paidAiCalls: 10,
    errors: 0,
    estimatedCostUsd: 0.1,
    commanderName: "Commander",
    commanderColors: ["G"],
    commanderColorsAvailableByTurn5: ["G"],
    missingCommanderColorsByTurn5: [],
    openingManaColors: ["G"],
    keptOpeningHand: true,
    manualRecoveries: 0,
    benchmarkOpponents: archetypes.map((archetype, offset) => ({
      id: `${index}-${offset}`,
      name: `${archetype} deck`,
      sourceUrl: "https://archidekt.com",
      archetype,
      bracket: 3,
    })),
  };
}

describe("deck diagnosis benchmark evidence", () => {
  it("marks tiny samples as insufficient", () => {
    const reports = [report(1, true, ["aggro", "value", "combo"])];
    const diagnosis = analyzeWorkbenchDeckTest(reports, summarizeWorkbenchDeckTest(reports));
    expect(diagnosis.sample.status).toBe("insufficient");
    expect(diagnosis.deckFindings.some((finding) => finding.id.startsWith("matchup:"))).toBe(false);
  });

  it("uses a 25 percent equal-share baseline for four-player benchmark games", () => {
    const reports = Array.from({ length: 12 }, (_, index) =>
      report(index, index < 3, ["aggro", "value", "control"]),
    );
    const diagnosis = analyzeWorkbenchDeckTest(reports, summarizeWorkbenchDeckTest(reports));
    expect(diagnosis.benchmark.equalShareBaseline).toBe(0.25);
    expect(diagnosis.benchmark.winRate).toBe(0.25);
    expect(diagnosis.sample.status).toBe("useful");
  });

  it("requires repeated matchup evidence before flagging an archetype weakness", () => {
    const reports = Array.from({ length: 12 }, (_, index) =>
      report(index, index % 3 === 0, [index < 6 ? "combo" : "aggro", "value", "control"]),
    );
    const diagnosis = analyzeWorkbenchDeckTest(reports, summarizeWorkbenchDeckTest(reports));
    const combo = diagnosis.benchmark.matchups.find((item) => item.archetype === "combo");
    expect(combo?.games).toBe(6);
    expect(combo?.confidence).toBe("medium");
  });
});
