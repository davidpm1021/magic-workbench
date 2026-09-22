import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
import { classifyWorkbenchDecision } from "./decisionImportance";

function prompt(input: Record<string, unknown>): Prompt {
  return { promptId: "1", input } as unknown as Prompt;
}

describe("classifyWorkbenchDecision", () => {
  it("treats empty priority as routine", () => {
    expect(
      classifyWorkbenchDecision(prompt({ type: "chooseAction", actions: [] })).importance,
    ).toBe("routine");
  });

  it("treats mana-only priority as routine", () => {
    expect(
      classifyWorkbenchDecision(
        prompt({
          type: "chooseAction",
          actions: [
            {
              id: "mana-1",
              type: "activateAbility",
              cardId: "land-1",
              abilityIndex: 0,
              description: "Add G",
              isManaAbility: true,
            },
          ],
        }),
      ).importance,
    ).toBe("routine");
  });

  it("treats casting and non-mana activations as strategic", () => {
    expect(
      classifyWorkbenchDecision(
        prompt({
          type: "chooseAction",
          actions: [
            {
              id: "cast-1",
              type: "cast",
              cardId: "card-1",
              label: "Cast spell",
              mode: { type: "normal" },
            },
          ],
        }),
      ).importance,
    ).toBe("strategic");

    expect(
      classifyWorkbenchDecision(
        prompt({
          type: "chooseAction",
          actions: [
            {
              id: "ability-1",
              type: "activateAbility",
              cardId: "card-2",
              abilityIndex: 1,
              description: "Draw a card",
              isManaAbility: false,
            },
          ],
        }),
      ).importance,
    ).toBe("strategic");
  });

  it("treats combat and mulligan decisions as strategic", () => {
    expect(classifyWorkbenchDecision(prompt({ type: "mulligan" })).importance).toBe("strategic");
    expect(classifyWorkbenchDecision(prompt({ type: "chooseAttackers" })).importance).toBe(
      "strategic",
    );
  });
});
