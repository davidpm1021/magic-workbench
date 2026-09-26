import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
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

  it("keeps long graveyard/exile zones lean except for cards relevant to the current prompt", () => {
    const graveCard = (id: string, name: string, text: string) => ({
      id,
      identity: { name },
      zoneId: "graveyard",
      controllerId: "player-1",
      ownerId: "player-1",
      manaCost: "{1}{B}",
      cmc: 2,
      types: ["Instant"],
      subtypes: [],
      power: null,
      toughness: null,
      text,
      tapped: false,
      isAttacking: false,
      summoningSick: false,
      keywords: [],
      counters: {},
      damage: 0,
      choices: [],
      attachmentIds: [],
    });

    const view = {
      gameId: "game-long",
      turn: 20,
      step: "main1",
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      gameOver: false,
      players: [
        {
          id: "player-0",
          name: "You",
          status: "playing",
          life: 30,
          handCount: 0,
          libraryCount: 60,
          hand: [],
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
        {
          id: "player-1",
          name: "Opponent",
          status: "playing",
          life: 30,
          handCount: 0,
          libraryCount: 60,
          hand: [],
          graveyard: [
            graveCard("terminate", "Terminate", "Destroy target creature. It can't be regenerated."),
            graveCard("other", "Other Spell", "Draw three cards, then discard a card."),
          ],
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
    } as unknown as ClientGameView;
    const prompt = {
      promptId: 1,
      decidingPlayerId: "player-0",
      input: {
        type: "chooseBoardTargets",
        presentation: { title: "Exile", targets: [] },
        candidates: [{ kind: "card", id: "terminate" }],
        hostile: true,
        intent: "exile",
        minTargets: 1,
        maxTargets: 1,
        chosenTargets: 0,
        cancellable: false,
      },
    } as unknown as Prompt;

    const compact = compactWorkbenchGameView(view, prompt);
    const opponent = compact.players[1];
    const graveyard = opponent.graveyard as Array<Record<string, unknown>>;
    expect(graveyard[0]?.text).toBe("Destroy target creature. It can't be regenerated.");
    expect(graveyard[1]?.text).toBeUndefined();
    expect(graveyard[1]).toEqual(
      expect.objectContaining({
        id: "other",
        name: "Other Spell",
        cmc: 2,
      }),
    );
  });

  it("deduplicates repeated battlefield characteristics while keeping individual IDs and state", () => {
    const token = (id: string, tapped: boolean) => ({
      id,
      identity: { name: "Monk Token" },
      zoneId: "battlefield",
      controllerId: "player-0",
      ownerId: "player-0",
      manaCost: "",
      cmc: 0,
      types: ["Creature"],
      subtypes: ["Monk"],
      power: "1",
      toughness: "1",
      text: "Prowess",
      tapped,
      isAttacking: false,
      summoningSick: false,
      keywords: ["Prowess"],
      counters: {},
      damage: 0,
      choices: [],
      attachmentIds: [],
    });

    const view = {
      gameId: "game-2",
      turn: 10,
      step: "main1",
      players: [],
      battlefield: [token("token-1", false), token("token-2", true)],
      stack: [],
      combatAssignments: [],
    } as unknown as ClientGameView;

    const compact = compactWorkbenchGameView(view);
    const battlefield = compact.battlefield as Array<Record<string, unknown>>;
    expect(battlefield[0]?.text).toBe("Prowess");
    expect(battlefield[1]?.sameCharacteristicsAs).toBe("token-1");
    expect(battlefield[1]?.text).toBeUndefined();
    expect(battlefield[1]?.id).toBe("token-2");
    expect(battlefield[1]?.tapped).toBe(true);
  });

});
