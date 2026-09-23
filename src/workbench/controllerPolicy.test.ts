import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import {
  buildMaterialDecisionFingerprint,
  chooseActionHasOnlyManaManagement,
  chooseCachedManaPlanStep,
  chooseDeterministicManaPlan,
  chooseDeterministicManaStep,
  isManaManagementAction,
  promptForWorkbenchModel,
  buildWorkbenchDecisionContext,
  countRepeatedSamePromptDecision,
  shouldCompleteWorkbenchTransaction,
  summarizeWorkbenchStateDelta,
} from "./controllerPolicy";

function view(pool: Record<string, number> = {}): ClientGameView {
  return {
    gameId: "g",
    turn: 3,
    step: "main1",
    players: [
      {
        id: "player-0",
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...pool },
      },
    ],
    battlefield: [],
    stack: [],
  } as unknown as ClientGameView;
}

describe("Workbench controller policy", () => {
  it("recognizes ordinary mana-management actions", () => {
    expect(
      isManaManagementAction({
        type: "activateAbility",
        id: "tap-land",
        isManaAbility: true,
      }),
    ).toBe(true);
    expect(isManaManagementAction({ type: "undoMana", id: "undo" })).toBe(true);
    expect(
      isManaManagementAction({
        type: "activateAbility",
        id: "draw",
        isManaAbility: false,
      }),
    ).toBe(false);
  });

  it("hides mana plumbing when strategic actions are available", () => {
    const prompt = {
      promptId: 1,
      input: {
        type: "chooseAction",
        actions: [
          { type: "activateAbility", id: "tap-land", isManaAbility: true },
          { type: "cast", id: "cast-1", cardId: "c1", label: "Cast Consider", mode: { type: "normal" } },
        ],
      },
    } as unknown as Prompt;

    const filtered = promptForWorkbenchModel(prompt);
    expect(filtered.input.type).toBe("chooseAction");
    if (filtered.input.type !== "chooseAction") throw new Error("wrong prompt");
    expect(filtered.input.actions.map((action) => action.id)).toEqual(["cast-1"]);
  });

  it("detects mana-only priority prompts", () => {
    const prompt = {
      promptId: 1,
      input: {
        type: "chooseAction",
        actions: [{ type: "activateAbility", id: "tap-land", isManaAbility: true }],
      },
    } as unknown as Prompt;
    expect(chooseActionHasOnlyManaManagement(prompt)).toBe(true);
  });

  it("pays a fixed colored requirement deterministically", () => {
    const prompt = {
      promptId: 2,
      input: {
        type: "payManaCost",
        manaCost: "{1}{U}",
        canConfirmFromPool: false,
        actions: [
          {
            type: "activateManaAbility",
            id: "tap-island",
            cardId: "island",
            producedMana: [{ color: "U", amount: 1 }],
          },
          {
            type: "activateManaAbility",
            id: "tap-swamp",
            cardId: "swamp",
            producedMana: [{ color: "B", amount: 1 }],
          },
        ],
      },
    } as unknown as Prompt;

    expect(chooseDeterministicManaStep(prompt, view(), "player-0")).toEqual({
      type: "act",
      actionId: "tap-island",
    });
  });

  it("leaves source selection to the model when multiple permanents can pay the same color", () => {
    const prompt = {
      promptId: 22,
      input: {
        type: "payManaCost",
        manaCost: "{U}",
        canConfirmFromPool: false,
        actions: [
          {
            type: "activateManaAbility",
            id: "tap-island",
            cardId: "island",
            producedMana: [{ color: "U", amount: 1 }],
          },
          {
            type: "activateManaAbility",
            id: "tap-islet",
            cardId: "islet",
            producedMana: [{ color: "U", amount: 1 }],
          },
        ],
      },
    } as unknown as Prompt;

    expect(chooseDeterministicManaStep(prompt, view(), "player-0")).toBeNull();
  });

  it("uses a flexible source deterministically when exactly one color is still required", () => {
    const prompt = {
      promptId: 3,
      input: {
        type: "payManaCost",
        manaCost: "{2}{G}",
        canConfirmFromPool: false,
        actions: [
          {
            type: "activateManaAbility",
            id: "tap-command-tower",
            cardId: "tower",
            isManaAbility: true,
          },
        ],
      },
    } as unknown as Prompt;
    const game = {
      ...view({ G: 0, R: 2 }),
      players: [
        {
          id: "player-0",
          manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 },
          commandZone: [{ manaCost: "{4}{G}{U}{R}" }],
        },
      ],
      battlefield: [
        {
          id: "tower",
          controllerId: "player-0",
          tapped: false,
          summoningSick: false,
          types: ["Land"],
          text: "{T}: Add one mana of any color in your commander's color identity.",
          identity: { name: "Command Tower" },
        },
      ],
    } as unknown as ClientGameView;

    expect(chooseDeterministicManaPlan(prompt, game, "player-0")).toEqual({
      output: { type: "act", actionId: "tap-command-tower" },
      preferredColor: "G",
    });
  });

  it("leaves ambiguous flexible mana to the model", () => {
    const prompt = {
      promptId: 2,
      input: {
        type: "payManaCost",
        manaCost: "{W}",
        canConfirmFromPool: false,
        actions: [
          {
            type: "activateManaAbility",
            id: "signet",
            cardId: "signet",
            producedMana: [
              { color: "W", amount: 1 },
              { color: "U", amount: 1 },
            ],
          },
        ],
      },
    } as unknown as Prompt;

    expect(chooseDeterministicManaStep(prompt, view(), "player-0")).toBeNull();
  });

  it("continues a cached mana plan only while its next action remains engine-legal", () => {
    const prompt = {
      promptId: 4,
      input: {
        type: "payManaCost",
        manaCost: "{1}{U}",
        canConfirmFromPool: false,
        actions: [
          {
            type: "activateManaAbility",
            id: "tap:island:0:U",
            cardId: "island",
            producedMana: [{ color: "U", amount: 1 }],
          },
          {
            type: "activateManaAbility",
            id: "tap:swamp:0:B",
            cardId: "swamp",
            producedMana: [{ color: "B", amount: 1 }],
          },
        ],
      },
    } as unknown as Prompt;

    expect(
      chooseCachedManaPlanStep(prompt, [
        "tap:island:0:U",
        "tap:swamp:0:B",
      ]),
    ).toEqual({
      output: { type: "act", actionId: "tap:island:0:U" },
      preferredColor: "U",
      remainingActionIds: ["tap:swamp:0:B"],
    });

    expect(
      chooseCachedManaPlanStep(prompt, ["tap:missing:0:U"]),
    ).toBeNull();
  });

  it("keeps transaction outcomes open until the prompt advanced and the stack cleared", () => {
    const chooseAction = {
      promptId: 9,
      input: { type: "chooseAction", actions: [] },
    } as unknown as Prompt;
    const payMana = {
      promptId: 8,
      input: {
        type: "payManaCost",
        manaCost: "{1}",
        canConfirmFromPool: false,
        actions: [],
      },
    } as unknown as Prompt;

    expect(
      shouldCompleteWorkbenchTransaction({
        gameOver: false,
        promptAdvanced: true,
        currentPrompt: payMana,
        stackSize: 0,
        isWaitingForResponse: false,
      }),
    ).toBe(false);
    expect(
      shouldCompleteWorkbenchTransaction({
        gameOver: false,
        promptAdvanced: true,
        currentPrompt: chooseAction,
        stackSize: 1,
        isWaitingForResponse: false,
      }),
    ).toBe(false);
    expect(
      shouldCompleteWorkbenchTransaction({
        gameOver: false,
        promptAdvanced: true,
        currentPrompt: chooseAction,
        stackSize: 0,
        isWaitingForResponse: false,
      }),
    ).toBe(true);
  });

  it("only treats repeats of the same engine prompt as a loop", () => {
    const base = {
      output: { type: "decision", value: false } as const,
      label: "No",
      reason: "Decline.",
      model: "test-model",
      promptType: "chooseBoolean",
      importance: "routine" as const,
      latencyMs: 1,
      gameId: "g",
      usage: null,
      estimatedCostUsd: 0,
      promptFingerprint: JSON.stringify({ type: "chooseBoolean", title: "May?" }),
      createdAt: 1,
    };

    const recommendation = { ...base, promptId: 30 };
    const history = [
      { ...base, promptId: 28, createdAt: 1 },
      { ...base, promptId: 29, createdAt: 2 },
    ];

    expect(countRepeatedSamePromptDecision(history, recommendation)).toBe(0);

    const actualLoop = [
      { ...base, promptId: 30, createdAt: 1 },
      { ...base, promptId: 30, createdAt: 2 },
    ];
    expect(countRepeatedSamePromptDecision(actualLoop, recommendation)).toBe(2);
  });

  it("provides grounded strategic facts for land counts and visible blockers", () => {
    const game = {
      ...view(),
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 40,
          manaPool: {},
          hand: [
            { types: ["Land"] },
            { types: ["Creature"] },
            { types: ["Land"] },
          ],
          landsPlayedThisTurn: 0,
          maxLandPlaysPerTurn: 1,
        },
        {
          id: "player-1",
          life: 17,
          manaPool: {},
          hand: [],
          landsPlayedThisTurn: 0,
          maxLandPlaysPerTurn: 1,
        },
      ],
      battlefield: [
        {
          id: "blocker",
          controllerId: "player-1",
          tapped: false,
          types: ["Creature"],
        },
        {
          id: "tapped-creature",
          controllerId: "player-1",
          tapped: true,
          types: ["Creature"],
        },
      ],
    } as unknown as ClientGameView;

    const context = buildWorkbenchDecisionContext({
      auditLog: [],
      gameView: game,
      gameLog: [],
      currentPrompt: {
        promptId: 77,
        decidingPlayerId: "player-0",
        input: { type: "chooseBoolean", presentation: { title: "Test", targets: [] } },
      } as unknown as Prompt,
    });

    expect(context.strategicFacts).toEqual({
      isActivePlayer: true,
      turnsTaken: 1,
      currentPlayerTurnNumber: 1,
      landsInHand: 2,
      landDropsRemaining: 1,
      readyAttackers: {
        count: 0,
        knownPower: 0,
        unknownPowerCount: 0,
      },
      opponents: [
        {
          id: "player-1",
          life: 17,
          visibleUntappedCreatures: 1,
          visibleUntappedPotentialBlockers: 1,
        },
      ],
      combatAssignments: [],
      unblockedAttackers: [],
      commanderThreats: [],
      ownCommanders: [],
      fightOutcomes: [],
    });
  });

  it("grounds ready attack power and the player's own turn number", () => {
    const game = {
      ...view(),
      turn: 6,
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 40,
          manaPool: {},
          hand: [],
          landsPlayedThisTurn: 1,
          maxLandPlaysPerTurn: 1,
        },
        {
          id: "player-1",
          life: 12,
          manaPool: {},
          hand: [],
          landsPlayedThisTurn: 0,
          maxLandPlaysPerTurn: 1,
        },
      ],
      battlefield: [
        {
          id: "dragon",
          controllerId: "player-0",
          tapped: false,
          summoningSick: false,
          types: ["Creature"],
          power: "7",
          keywords: ["Flying"],
        },
        {
          id: "haste",
          controllerId: "player-0",
          tapped: false,
          summoningSick: true,
          types: ["Creature"],
          power: "3",
          keywords: ["Haste"],
        },
        {
          id: "sick",
          controllerId: "player-0",
          tapped: false,
          summoningSick: true,
          types: ["Creature"],
          power: "5",
          keywords: [],
        },
      ],
    } as unknown as ClientGameView;

    const context = buildWorkbenchDecisionContext({
      auditLog: [
        {
          id: "t2",
          gameId: "g",
          createdAt: 1,
          source: "deterministic",
          status: "deterministic",
          promptId: 1,
          promptType: "chooseAction",
          importance: "deterministic",
          model: null,
          latencyMs: 0,
          usage: null,
          estimatedCostUsd: 0,
          reason: "turn",
          output: { type: "pass", exhaustStack: false },
          error: null,
          responseStatus: null,
          incompleteReason: null,
          rawModelText: null,
          promptSnapshot: null,
          visibleGameState: { turn: 2, step: "main1", activePlayerId: "player-0" },
        },
        {
          id: "t4",
          gameId: "g",
          createdAt: 2,
          source: "deterministic",
          status: "deterministic",
          promptId: 2,
          promptType: "chooseAction",
          importance: "deterministic",
          model: null,
          latencyMs: 0,
          usage: null,
          estimatedCostUsd: 0,
          reason: "turn",
          output: { type: "pass", exhaustStack: false },
          error: null,
          responseStatus: null,
          incompleteReason: null,
          rawModelText: null,
          promptSnapshot: null,
          visibleGameState: { turn: 4, step: "main1", activePlayerId: "player-0" },
        },
      ],
      gameView: game,
      gameLog: [],
      currentPrompt: {
        promptId: 88,
        decidingPlayerId: "player-0",
        input: { type: "chooseAttackers", attackers: [] },
      } as unknown as Prompt,
    });

    expect(context.strategicFacts.turnsTaken).toBe(3);
    expect(context.strategicFacts.currentPlayerTurnNumber).toBe(3);
    expect(context.strategicFacts.readyAttackers).toEqual({
      count: 2,
      knownPower: 10,
      unknownPowerCount: 0,
    });
  });

  it("compacts large chooseCards candidates for the model", () => {
    const prompt = {
      promptId: 120,
      sourceCard: { id: "tutor", identity: { name: "Solve the Equation" } },
      input: {
        type: "chooseCards",
        presentation: { title: "Search", targets: [] },
        cards: [
          {
            id: "candidate",
            identity: { name: "Temur Battle Rage", setCode: "CMM", cardNumber: "264" },
            manaCost: "{1}{R}",
            cmc: 2,
            types: ["Instant"],
            subtypes: [],
            text: "Target creature gains double strike until end of turn.",
            keywords: [],
            counters: {},
            choices: [],
            attachmentIds: [],
            isFaceDown: false,
            isTransformed: false,
          },
        ],
        min: 1,
        max: 1,
      },
    } as unknown as Prompt;

    const compact = promptForWorkbenchModel(prompt) as unknown as {
      input: { cards: Array<Record<string, unknown>> };
    };
    expect(compact.input.cards[0]).toEqual(
      expect.objectContaining({
        id: "candidate",
        manaCost: "{1}{R}",
        text: "Target creature gains double strike until end of turn.",
      }),
    );
    expect(compact.input.cards[0]).not.toHaveProperty("choices");
    expect(compact.input.cards[0]).not.toHaveProperty("attachmentIds");
  });

  it("computes fight, combat, and commander-damage facts from visible state", () => {
    const game = {
      ...view(),
      turn: 8,
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 38,
          manaPool: {},
          hand: [
            {
              id: "denial",
              identity: { name: "Decisive Denial" },
              types: ["Instant"],
              text: "Choose one — Target creature you control fights target creature you don't control.",
            },
          ],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
          commanderCasts: { haldan: 1, pako: 1 },
          landsPlayedThisTurn: 1,
          maxLandPlaysPerTurn: 1,
        },
        {
          id: "player-1",
          life: 30,
          manaPool: {},
          hand: [],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
          commanderDamage: { pako: 15 },
          landsPlayedThisTurn: 0,
          maxLandPlaysPerTurn: 1,
        },
      ],
      battlefield: [
        {
          id: "haldan",
          identity: { name: "Haldan, Avid Arcanist" },
          controllerId: "player-0",
          types: ["Creature"],
          power: "1",
          toughness: "4",
          damage: 0,
          tapped: false,
          summoningSick: false,
          keywords: [],
        },
        {
          id: "pako",
          identity: { name: "Pako, Arcane Retriever" },
          controllerId: "player-0",
          types: ["Creature"],
          power: "5",
          toughness: "5",
          damage: 0,
          tapped: false,
          isAttacking: true,
          summoningSick: false,
          keywords: ["Haste"],
        },
        {
          id: "archmage",
          identity: { name: "Archmage Emeritus" },
          controllerId: "player-1",
          types: ["Creature"],
          power: "2",
          toughness: "2",
          damage: 0,
          tapped: false,
          summoningSick: false,
          keywords: [],
        },
        {
          id: "wall",
          identity: { name: "Wall of Omens" },
          controllerId: "player-1",
          types: ["Creature"],
          power: "0",
          toughness: "4",
          damage: 0,
          tapped: false,
          summoningSick: false,
          keywords: ["Defender"],
        },
      ],
      combatAssignments: [{ blockerId: "wall", attackerId: "haldan" }],
    } as unknown as ClientGameView;

    const context = buildWorkbenchDecisionContext({
      auditLog: [],
      gameView: game,
      gameLog: [],
      currentPrompt: {
        promptId: 121,
        decidingPlayerId: "player-0",
        input: {
          type: "chooseAction",
          actions: [
            {
              id: "cast-denial",
              type: "cast",
              cardId: "denial",
              label: "Cast Decisive Denial",
              mode: { type: "normal" },
            },
          ],
        },
      } as unknown as Prompt,
    });

    expect(context.strategicFacts.combatAssignments).toEqual([
      {
        attackerId: "haldan",
        attackerName: "Haldan, Avid Arcanist",
        blockerId: "wall",
        blockerName: "Wall of Omens",
      },
    ]);
    expect(context.strategicFacts.unblockedAttackers).toEqual([
      { id: "pako", name: "Pako, Arcane Retriever", power: 5 },
    ]);
    expect(context.strategicFacts.commanderThreats).toContainEqual(
      expect.objectContaining({
        opponentId: "player-1",
        commanderId: "pako",
        damageDealt: 15,
        damageNeeded: 6,
        currentPower: 5,
        lethalIfUnblockedNow: false,
      }),
    );
    expect(context.strategicFacts.fightOutcomes).toContainEqual(
      expect.objectContaining({
        sourceId: "haldan",
        targetId: "archmage",
        damageToTarget: 1,
        damageToSource: 2,
        targetLethalByToughness: false,
        sourceLethalByToughness: false,
      }),
    );
  });

  it("keeps a material-state fingerprint stable across phase-only changes", () => {
    const prompt = {
      promptId: 130,
      input: {
        type: "chooseAction",
        actions: [
          {
            id: "cast-high-tide",
            type: "cast",
            cardId: "high-tide",
            label: "Cast High Tide",
            mode: { type: "normal" },
          },
        ],
      },
    } as unknown as Prompt;
    const base = {
      ...view(),
      turn: 4,
      step: "main1",
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 40,
          handCount: 1,
          libraryCount: 90,
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          hand: [{ id: "high-tide" }],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
          counters: {},
          commanderDamage: {},
          commanderCasts: {},
          landsPlayedThisTurn: 1,
          cardsDrawnThisTurn: 1,
        },
      ],
      battlefield: [],
      stack: [],
      combatAssignments: [],
    } as unknown as ClientGameView;
    const combat = { ...base, step: "combatBegin" } as ClientGameView;
    const changed = {
      ...combat,
      players: [{ ...combat.players[0], life: 39 }],
    } as ClientGameView;

    expect(buildMaterialDecisionFingerprint(prompt, base)).toBe(
      buildMaterialDecisionFingerprint(prompt, combat),
    );
    expect(buildMaterialDecisionFingerprint(prompt, changed)).not.toBe(
      buildMaterialDecisionFingerprint(prompt, base),
    );
  });

  it("does not invalidate an action-scoped yield for unrelated opponent life changes", () => {
    const prompt = {
      promptId: 131,
      decidingPlayerId: "player-0",
      input: {
        type: "chooseAction",
        actions: [
          {
            id: "cast-high-tide",
            type: "cast",
            cardId: "high-tide",
            label: "Cast High Tide",
            mode: { type: "normal" },
          },
        ],
      },
    } as unknown as Prompt;
    const base = {
      ...view(),
      turn: 4,
      activePlayerId: "player-1",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 30,
          manaPool: {},
          hand: [{ id: "high-tide" }],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
        },
        {
          id: "player-1",
          life: 40,
          manaPool: {},
          hand: [],
          graveyard: [],
          exile: [],
          commandZone: [],
          library: [],
        },
      ],
      battlefield: [],
      stack: [],
      combatAssignments: [],
    } as unknown as ClientGameView;
    const unrelated = {
      ...base,
      players: [base.players[0], { ...base.players[1], life: 37 }],
    } as ClientGameView;

    expect(buildMaterialDecisionFingerprint(prompt, unrelated)).toBe(
      buildMaterialDecisionFingerprint(prompt, base),
    );
  });

  it("exposes authoritative owner/controller and zone-active facts for unusual commanders", () => {
    const game = {
      ...view(),
      activePlayerId: "player-0",
      priorityPlayerId: "player-0",
      players: [
        {
          id: "player-0",
          life: 10,
          manaPool: {},
          hand: [],
          graveyard: [],
          exile: [],
          library: [],
          commandZone: [
            {
              id: "saruman",
              identity: { name: "Saruman of Many Colors" },
              zoneId: "command",
              controllerId: "player-0",
              ownerId: "player-0",
              types: ["Creature"],
              text: "Whenever you cast your second spell each turn, each opponent mills two cards.",
            },
          ],
          commanderCasts: { saruman: 0 },
        },
        {
          id: "player-1",
          life: 46,
          manaPool: {},
          hand: [],
          graveyard: [],
          exile: [],
          library: [],
          commandZone: [],
          commanderCasts: { xantcha: 1 },
        },
      ],
      battlefield: [
        {
          id: "xantcha",
          identity: { name: "Xantcha, Sleeper Agent" },
          zoneId: "battlefield",
          controllerId: "player-0",
          ownerId: "player-1",
          types: ["Creature"],
          text: "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.",
          tapped: false,
          summoningSick: false,
          keywords: [],
        },
      ],
      stack: [],
      combatAssignments: [],
    } as unknown as ClientGameView;

    const xantchaContext = buildWorkbenchDecisionContext({
      auditLog: [],
      gameView: game,
      gameLog: [],
      currentPrompt: {
        promptId: 132,
        decidingPlayerId: "player-0",
        input: {
          type: "chooseAction",
          actions: [
            {
              id: "activate-xantcha",
              type: "activateAbility",
              cardId: "xantcha",
              abilityIndex: 0,
              description: "{3}: Xantcha's controller loses 2 life and you draw a card.",
              isManaAbility: false,
            },
          ],
        },
      } as unknown as Prompt,
    });

    expect(xantchaContext.actionSourceFacts[0]).toEqual(
      expect.objectContaining({
        cardId: "xantcha",
        zone: "battlefield",
        controllerId: "player-0",
        ownerId: "player-1",
        permanentBattlefieldAbilitiesActiveByDefault: true,
      }),
    );

    const sarumanContext = buildWorkbenchDecisionContext({
      auditLog: [],
      gameView: game,
      gameLog: [],
      currentPrompt: {
        promptId: 133,
        decidingPlayerId: "player-0",
        input: {
          type: "chooseAction",
          actions: [
            {
              id: "cast-saruman",
              type: "cast",
              cardId: "saruman",
              label: "Cast Saruman of Many Colors",
              mode: { type: "normal" },
            },
          ],
        },
      } as unknown as Prompt,
    });

    expect(sarumanContext.actionSourceFacts[0]).toEqual(
      expect.objectContaining({
        cardId: "saruman",
        zone: "command",
        permanentBattlefieldAbilitiesActiveByDefault: false,
      }),
    );
  });

  it("summarizes visible post-decision state changes for the audit", () => {
    const before = {
      players: [{ id: "player-0", life: 20, handCount: 3, libraryCount: 80, commanderDamage: {} }],
      battlefield: [
        { id: "a", name: "Haldan, Avid Arcanist", damage: 0, tapped: false, counters: {} },
        { id: "b", name: "Archmage Emeritus", damage: 0, tapped: false, counters: {} },
      ],
      stack: [],
    };
    const after = {
      players: [{ id: "player-0", life: 19, handCount: 3, libraryCount: 80, commanderDamage: {} }],
      battlefield: [
        { id: "a", name: "Haldan, Avid Arcanist", damage: 2, tapped: false, counters: {} },
        { id: "b", name: "Archmage Emeritus", damage: 1, tapped: false, counters: {} },
      ],
      stack: [],
    };

    expect(summarizeWorkbenchStateDelta(before, after)).toEqual(
      expect.arrayContaining([
        "player-0 life: 20 -> 19",
        "Haldan, Avid Arcanist damage: 0 -> 2",
        "Archmage Emeritus damage: 0 -> 1",
      ]),
    );
  });

  it("derives actual spells cast this turn from engine log continuity", () => {
    const game = view();
    const context = buildWorkbenchDecisionContext({
      auditLog: [
        {
          id: "a1",
          gameId: "g",
          createdAt: 1000,
          source: "deterministic",
          status: "deterministic",
          promptId: 1,
          promptType: "chooseAction",
          importance: "deterministic",
          model: null,
          latencyMs: 0,
          usage: null,
          estimatedCostUsd: 0,
          reason: "start",
          output: { type: "pass", exhaustStack: false },
          error: null,
          responseStatus: null,
          incompleteReason: null,
          rawModelText: null,
          promptSnapshot: null,
          visibleGameState: { turn: 3, step: "upkeep" },
        },
      ],
      gameView: game,
      gameLog: [
        { message: "Cast: Consider", entryType: "stack", timestampMs: 1100 },
        { message: "Cast: Charcoal Diamond", entryType: "stack", timestampMs: 1200 },
      ],
    });

    expect(context.spellsActuallyCastThisTurn).toEqual(["Consider", "Charcoal Diamond"]);
    expect(context.secondSpellAlreadyCast).toBe(true);
  });

});
