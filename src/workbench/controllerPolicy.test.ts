import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import {
  chooseActionHasOnlyManaManagement,
  chooseDeterministicManaPlan,
  chooseDeterministicManaStep,
  isManaManagementAction,
  promptForWorkbenchModel,
  buildWorkbenchDecisionContext,
  countRepeatedSamePromptDecision,
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
