import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import {
  chooseActionHasOnlyManaManagement,
  chooseDeterministicManaStep,
  isManaManagementAction,
  promptForWorkbenchModel,
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
});
