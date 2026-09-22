import { describe, expect, it } from "vitest";
import type { ClientGameView } from "@/stores/gameStore.types";
import { compactWorkbenchGameView } from "./compactGameView";

describe("compactWorkbenchGameView", () => {
  it("drops raw zones while keeping visible strategic state", () => {
    const view = {
      gameId: "game-1",
      turn: 4,
      step: "main1",
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      gameOver: false,
      players: [
        {
          id: "player-0",
          name: "You",
          status: "playing",
          life: 37,
          handCount: 1,
          libraryCount: 92,
          hand: [
            {
              id: "card-1",
              identity: { name: "Sol Ring" },
              zoneId: "hand",
              controllerId: "player-0",
              ownerId: "player-0",
              manaCost: "{1}",
              cmc: 1,
              types: ["Artifact"],
              subtypes: [],
              text: "{T}: Add {C}{C}.",
              tapped: false,
              keywords: [],
              counters: {},
              damage: 0,
              choices: [],
              attachmentIds: [],
            },
          ],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
          manaPool: {},
          counters: {},
          commanderDamage: {},
          commanderCasts: {},
          poison: 0,
          energyCounters: 0,
          experienceCounters: 0,
          radiationCounters: 0,
          ticketCounters: 0,
          landsPlayedThisTurn: 1,
          maxLandPlaysPerTurn: 1,
          cardsDrawnThisTurn: 1,
          playerKeywords: [],
        },
      ],
      battlefield: [],
      stack: [],
      combatAssignments: [],
      zones: [{ secret: "raw-zone-payload" }],
    } as unknown as ClientGameView;

    const compact = compactWorkbenchGameView(view) as unknown as Record<string, unknown>;
    expect(compact).not.toHaveProperty("zones");
    expect(compact.turn).toBe(4);

    const players = compact.players as Array<Record<string, unknown>>;
    const hand = players[0]?.hand as Array<Record<string, unknown>>;
    expect(hand[0]?.name).toBe("Sol Ring");
    expect(hand[0]?.text).toBe("{T}: Add {C}{C}.");
  });
});
