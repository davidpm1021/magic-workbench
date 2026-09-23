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

function chooseCardsPrompt(): Prompt {
  return {
    promptId: "6",
    sourceCard: {
      id: "gemstone-caverns",
      identity: { name: "Gemstone Caverns" },
    },
    input: {
      type: "chooseCards",
      presentation: {
        title: "Gemstone Caverns",
        description: "Select a card from your hand",
        targets: [],
      },
      cards: [
        { id: "engine-card-7", identity: { name: "Artisan of Kozilek" } },
        { id: "engine-card-3", identity: { name: "Emrakul, the Promised End" } },
      ],
      min: 1,
      max: 1,
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

  it("normalizes the exact bare chooseCards response seen in the Gemstone Caverns audit", async () => {
    const audit: unknown[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        outputRules?: string[];
        workbenchResponseSchema?: Record<string, unknown>;
      };
      expect(body.outputRules).toBeUndefined();
      expect(body.workbenchResponseSchema).toEqual(
        expect.objectContaining({
          type: "object",
          required: ["output", "reason"],
          additionalProperties: false,
        }),
      );

      const messages = JSON.parse(String(init?.body ?? "{}")).messages as Array<{
        role: string;
        content: string;
      }>;
      const userMessage = JSON.parse(messages.find((message) => message.role === "user")!.content) as {
        outputRules: string[];
      };
      expect(userMessage.outputRules[0]).toContain("Set the top-level output field to");
      expect(userMessage.outputRules[0]).not.toMatch(/^Return /);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  type: "chooseCardsDecision",
                  chosenCardIds: ["engine-card-3"],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "gpt-6-luna",
      strategyPrompt: "Play well.",
      gameView,
      prompt: chooseCardsPrompt(),
      myPlayerSlot: "player-0",
      onAuditEntry: (entry) => audit.push(entry),
    });

    expect(result.output).toEqual({
      type: "chooseCardsDecision",
      chosenCardIds: ["engine-card-3"],
    });
    expect(result.reason).toContain("without the required output wrapper");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(
      expect.objectContaining({
        source: "ai",
        status: "success",
        promptType: "chooseCards",
        output: {
          type: "chooseCardsDecision",
          chosenCardIds: ["engine-card-3"],
        },
        rawModelText:
          '{"type":"chooseCardsDecision","chosenCardIds":["engine-card-3"]}',
      }),
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


  it("records a complete audit entry for a successful AI decision", async () => {
    const audit: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "act", actionId: "cast-1" },
                    reason: "Use the available tempo.",
                  }),
                },
              },
            ],
            workbenchUsage: {
              inputTokens: 100,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 20,
              reasoningTokens: 10,
              totalTokens: 120,
            },
            workbenchMeta: {
              responseStatus: "completed",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "gpt-6-luna",
      strategyPrompt: "Play well.",
      gameView,
      prompt: chooseActionPrompt(),
      myPlayerSlot: "player-0",
      onAuditEntry: (entry) => audit.push(entry),
    });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(
      expect.objectContaining({
        source: "ai",
        status: "success",
        promptType: "chooseAction",
        model: "gpt-6-luna",
        responseStatus: "completed",
        output: { type: "act", actionId: "cast-1" },
      }),
    );

    vi.unstubAllGlobals();
  });

  it("retries a transient Responses no-output failure once and aggregates usage", async () => {
    const audit: unknown[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "OpenAI Responses API returned no output text (status: completed).",
            },
            workbenchUsage: {
              inputTokens: 100,
              cachedInputTokens: 20,
              cacheWriteTokens: 0,
              outputTokens: 10,
              reasoningTokens: 10,
              totalTokens: 110,
            },
            workbenchMeta: {
              responseStatus: "completed",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "act", actionId: "cast-1" },
                    reason: "Retry produced a legal decision.",
                  }),
                },
              },
            ],
            workbenchUsage: {
              inputTokens: 90,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 20,
              reasoningTokens: 5,
              totalTokens: 110,
            },
            workbenchMeta: {
              responseStatus: "completed",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "gpt-6-luna",
      strategyPrompt: "Play well.",
      gameView,
      prompt: chooseActionPrompt(),
      myPlayerSlot: "player-0",
      onAuditEntry: (entry) => audit.push(entry),
    });

    expect(result.output).toEqual({ type: "act", actionId: "cast-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(
      expect.objectContaining({
        source: "ai",
        status: "success",
        usage: {
          inputTokens: 190,
          cachedInputTokens: 20,
          cacheWriteTokens: 0,
          outputTokens: 30,
          reasoningTokens: 15,
          totalTokens: 220,
        },
      }),
    );

    vi.unstubAllGlobals();
  });

  it("records provider failures including incomplete-response metadata", async () => {
    const audit: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "OpenAI used the output-token budget during reasoning before producing a decision.",
            },
            workbenchUsage: {
              inputTokens: 100,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 8000,
              reasoningTokens: 8000,
              totalTokens: 8100,
            },
            workbenchMeta: {
              responseStatus: "incomplete",
              incompleteReason: "max_output_tokens",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      requestWorkbenchDecision({
        baseUrl: "/workbench-ai",
        model: "gpt-6-luna",
        strategyPrompt: "Play well.",
        gameView,
        prompt: chooseActionPrompt(),
        myPlayerSlot: "player-0",
        onAuditEntry: (entry) => audit.push(entry),
      }),
    ).rejects.toThrow("output-token budget");

    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual(
      expect.objectContaining({
        source: "ai",
        status: "error",
        responseStatus: "incomplete",
        incompleteReason: "max_output_tokens",
      }),
    );

    vi.unstubAllGlobals();
  });


  it("normalizes MTG color shorthand to the engine's legal color names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "colorDecision", chosenColors: { U: 1 } },
                    reason: "Use blue mana.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const prompt = {
      promptId: "99",
      input: {
        type: "chooseColor",
        presentation: { title: "Choose a color", targets: [] },
        validColors: ["White", "Blue", "Black"],
        amount: 1,
        repeatAllowed: false,
      },
    } as unknown as Prompt;

    const result = await requestWorkbenchDecision({
      baseUrl: "/workbench-ai",
      model: "test-model",
      strategyPrompt: "Play well.",
      gameView,
      prompt,
      myPlayerSlot: "player-0",
    });

    expect(result.output).toEqual({
      type: "colorDecision",
      chosenColors: { Blue: 1 },
    });

    vi.unstubAllGlobals();
  });

  it("still rejects a color outside the engine's legal list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    output: { type: "colorDecision", chosenColors: { R: 1 } },
                    reason: "Use red mana.",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const prompt = {
      promptId: "100",
      input: {
        type: "chooseColor",
        presentation: { title: "Choose a color", targets: [] },
        validColors: ["White", "Blue", "Black"],
        amount: 1,
        repeatAllowed: false,
      },
    } as unknown as Prompt;

    await expect(
      requestWorkbenchDecision({
        baseUrl: "/workbench-ai",
        model: "test-model",
        strategyPrompt: "Play well.",
        gameView,
        prompt,
        myPlayerSlot: "player-0",
      }),
    ).rejects.toThrow("Legal colors: White, Blue, Black");

    vi.unstubAllGlobals();
  });

});
