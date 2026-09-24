import { describe, expect, it } from "vitest";
import {
  buildWorkbenchGameTelemetry,
  captureWorkbenchTelemetrySnapshot,
  summarizeWorkbenchDeckTest,
} from "./deckTelemetry";

function snapshot(turn: number, args: {
  hand?: Array<{ id: string; name: string; types?: string[] }>;
  battlefield?: Array<{ id: string; name: string; types?: string[] }>;
  stack?: Array<{ id: string; name: string }>;
  commanderCasts?: number;
  life?: number;
  gameOver?: boolean;
  winnerId?: string | null;
}) {
  return captureWorkbenchTelemetrySnapshot({
    playerId: "player-0",
    deckName: "Test Deck",
    capturedAt: turn,
    compactGameView: {
      gameId: "game-1",
      turn,
      step: "MAIN1",
      activePlayerId: "player-0",
      gameOver: args.gameOver ?? false,
      winnerId: args.winnerId ?? null,
      players: [
        {
          id: "player-0",
          life: args.life ?? 40,
          handCount: args.hand?.length ?? 0,
          libraryCount: 90,
          landsPlayedThisTurn: 1,
          commanderCasts: args.commanderCasts ?? 0,
          manaPool: {},
          hand: args.hand ?? [],
          graveyard: [],
          exile: [],
          commandZone: [],
        },
      ],
      battlefield: (args.battlefield ?? []).map((card) => ({
        ...card,
        controllerId: "player-0",
      })),
      stack: (args.stack ?? []).map((item) => ({
        ...item,
        controllerId: "player-0",
      })),
    },
  })!;
}

describe("deck telemetry", () => {
  it("captures player-focused snapshots from compact game state", () => {
    const result = snapshot(2, {
      hand: [{ id: "h1", name: "Cultivate", types: ["Sorcery"] }],
      battlefield: [
        { id: "land-1", name: "Forest", types: ["Land"] },
        { id: "perm-1", name: "Llanowar Elves", types: ["Creature"] },
      ],
      commanderCasts: 1,
    });

    expect(result.deckName).toBe("Test Deck");
    expect(result.player.id).toBe("player-0");
    expect(result.battlefield.map((card) => card.name)).toEqual(["Forest", "Llanowar Elves"]);
    expect(result.player.commanderCasts).toBe(1);
  });

  it("derives per-game development and stuck-card metrics", () => {
    const snapshots = [
      snapshot(1, {
        hand: [
          { id: "h1", name: "Slow Spell", types: ["Sorcery"] },
          { id: "h2", name: "Forest", types: ["Land"] },
        ],
        battlefield: [{ id: "land-1", name: "Forest", types: ["Land"] }],
      }),
      snapshot(2, {
        hand: [{ id: "h1", name: "Slow Spell", types: ["Sorcery"] }],
        battlefield: [
          { id: "land-1", name: "Forest", types: ["Land"] },
          { id: "perm-1", name: "Llanowar Elves", types: ["Creature"] },
        ],
        stack: [{ id: "spell-1", name: "Llanowar Elves" }],
      }),
      snapshot(5, {
        hand: [
          { id: "h1", name: "Slow Spell", types: ["Sorcery"] },
          { id: "h3", name: "New Draw", types: ["Instant"] },
        ],
        battlefield: [
          { id: "land-1", name: "Forest", types: ["Land"] },
          { id: "land-2", name: "Forest", types: ["Land"] },
          { id: "perm-1", name: "Llanowar Elves", types: ["Creature"] },
        ],
        commanderCasts: 1,
        life: 31,
        gameOver: true,
        winnerId: "player-0",
      }),
    ];

    const report = buildWorkbenchGameTelemetry({
      gameId: "game-1",
      winnerId: "player-0",
      turn: 5,
      snapshots,
      auditEntries: [],
    });

    expect(report.won).toBe(true);
    expect(report.firstNonlandPermanentTurn).toBe(2);
    expect(report.firstCommanderCastTurn).toBe(5);
    expect(report.maxLandsOnBattlefield).toBe(2);
    expect(report.cardsCast).toEqual({ "Llanowar Elves": 1 });
    expect(report.stuckCards).toEqual([
      { name: "Slow Spell", maxObservedTurnSpan: 4 },
    ]);
    expect(report.cardsDrawnApprox).toBe(1);
    expect(report.lowestLife).toBe(31);
  });

  it("aggregates a deck-test series", () => {
    const base = buildWorkbenchGameTelemetry({
      gameId: "game-1",
      winnerId: "player-0",
      turn: 6,
      snapshots: [
        snapshot(1, { hand: [{ id: "a", name: "Slow Spell" }] }),
        snapshot(5, { hand: [{ id: "a", name: "Slow Spell" }], gameOver: true, winnerId: "player-0" }),
      ],
      auditEntries: [],
    });
    const second = {
      ...base,
      gameId: "game-2",
      winnerId: "player-1",
      won: false,
      firstNonlandPermanentTurn: 6,
      stuckCards: [{ name: "Slow Spell", maxObservedTurnSpan: 4 }],
    };

    const summary = summarizeWorkbenchDeckTest([base, second]);
    expect(summary.games).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.winRate).toBe(0.5);
    expect(summary.noNonlandPermanentByTurn4Rate).toBe(1);
    expect(summary.stuckCardGames["Slow Spell"]).toBe(2);
  });
});
