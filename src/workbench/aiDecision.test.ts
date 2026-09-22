import { describe, expect, it, vi } from "vitest";
import type { Prompt } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import {
  isWorkbenchAiPrompt,
  requestWorkbenchDecision,
} from "./aiDecision";

function chooseActionPrompt(actionId = "cast-1"): Prompt {
  return {
    promptId: "42",
    input: {
      type: "chooseAction",
      actions: [
        {
          id: actionId,
          type: "cast",
          cardId: "card-1",
          label: "Cast test spell",
          mode: { type: "normal" },
        },
      ],
    },
  } as unknown as Prompt;
}

function payManaPrompt(canConfirmFromPool: boolean): Prompt {
  return {
    promptId: "88",
    input: {
      type: "payManaCost",
      presentation: { title: "Test spell", targets: [] },
      cardId: "card-1",
      cardName: "Test spell",
      manaCost: "{G}",
      canConfirmFromPool,
      actions: [
        {
          id: "tap:forest-1:0",
          type: "activateManaAbility",
          cardId: "forest-1",
          abilityIndex: 0,
          description: "{T}: Add {G}.",
          isManaAbility: true,
        },
      ],
    },
  } as unknown as Prompt;
}

const gameView = {
  players: [],
  battlefield: [],
} as unknown as ClientGameView;

describe("Workbench AI decision boundary", () => {
  it("recognizes prompts the thinking controller supports", () => {
    expect(isWorkbenchAiPrompt(chooseActionPrompt())).toBe(true);
    expect(
      isWorkbenchAiPrompt({
        promptId: "9",
        input: { type: "gameOver" },
      } as unknown as Prompt),
    ).toBe(false);
  });

  it("accepts a model response only when it selects an engine-offered action", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  output: { type: "act", actionId: "cast-1" },
                  reason: "Develop the board.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "test-model",
      strategyPrompt: "Play well.",
      gameView,
      prompt: chooseActionPrompt(),
      myPlayerSlot: "player-0",
    });

    expect(result.promptId).toBe(42);
    expect(result.output).toEqual({ type: "act", actionId: "cast-1" });
    expect(result.reason).toBe("Develop the board.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/workbench-ai/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("rejects an action id the rules engine did not offer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "act", actionId: "invented-action" },
                    reason: "Try something illegal.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      requestWorkbenchDecision({
        baseUrl: "/workbench-ai",
        model: "test-model",
        strategyPrompt: "Play well.",
        gameView,
        prompt: chooseActionPrompt(),
        myPlayerSlot: "player-0",
      }),
    ).rejects.toThrow("rules engine did not offer");

    vi.unstubAllGlobals();
  });

  it("rejects pay before the mana pool can confirm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "pay", auto: true },
                    reason: "Auto-pay.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      requestWorkbenchDecision({
        baseUrl: "/workbench-ai",
        model: "test-model",
        strategyPrompt: "Play well.",
        gameView,
        prompt: payManaPrompt(false),
        myPlayerSlot: "player-0",
      }),
    ).rejects.toThrow("before the engine said the pool was ready");

    vi.unstubAllGlobals();
  });

  it("accepts one engine-offered incremental mana action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "act", actionId: "tap:forest-1:0" },
                    reason: "Tap the Forest.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "test-model",
      strategyPrompt: "Play well.",
      gameView,
      prompt: payManaPrompt(false),
      myPlayerSlot: "player-0",
    });

    expect(result.output).toEqual({ type: "act", actionId: "tap:forest-1:0" });
    vi.unstubAllGlobals();
  });

  it("normalizes a confirmable mana payment to a non-auto confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "pay", auto: true },
                    reason: "Confirm payment.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "test-model",
      strategyPrompt: "Play well.",
      gameView,
      prompt: payManaPrompt(true),
      myPlayerSlot: "player-0",
    });

    expect(result.output).toEqual({ type: "pay", auto: false });
    vi.unstubAllGlobals();
  });

});
