import type { Prompt } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import type {
  WorkbenchChoice,
  WorkbenchRecommendation,
} from "@/stores/useWorkbenchStore";

export interface WorkbenchAiRequest {
  baseUrl: string;
  model: string;
  apiKey?: string;
  strategyPrompt: string;
  gameView: ClientGameView;
  prompt: Prompt;
  myPlayerSlot: string | null;
  signal?: AbortSignal;
}

type ChatContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: ChatContent;
    };
  }>;
  error?: {
    message?: string;
  };
}

const PASS_CHOICE_ID = "__PASS_PRIORITY__";

export function isWorkbenchAiPrompt(prompt: Prompt | null): boolean {
  return prompt?.input.type === "chooseAction" || prompt?.input.type === "payManaCost";
}

export function workbenchChoiceToOutput(choice: WorkbenchChoice) {
  return choice.kind === "pass"
    ? ({ type: "pass", exhaustStack: false } as const)
    : ({ type: "act", actionId: choice.actionId } as const);
}

export async function requestWorkbenchDecision(
  request: WorkbenchAiRequest,
): Promise<WorkbenchRecommendation> {
  const { prompt, gameView } = request;
  if (!isWorkbenchAiPrompt(prompt)) {
    throw new Error(`Thinking AI does not support ${prompt.input.type} yet.`);
  }

  const actions = prompt.input.actions;
  const allowedActionIds = actions.map((action) => action.id);
  const choices =
    prompt.input.type === "chooseAction"
      ? [PASS_CHOICE_ID, ...allowedActionIds]
      : allowedActionIds;

  if (choices.length === 0) {
    throw new Error("The engine did not expose an action the AI can choose.");
  }

  const endpoint = chatCompletionsEndpoint(request.baseUrl);
  if (!request.model.trim()) throw new Error("Choose an AI model first.");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.apiKey.trim()
        ? { Authorization: `Bearer ${request.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: request.model.trim(),
      messages: [
        {
          role: "system",
          content:
            "You are piloting a Magic: The Gathering deck inside a deterministic rules engine. " +
            "You may only choose one choiceId from the supplied legal choices. Never invent an action. " +
            "Use only visible game information. Return JSON only: " +
            '{"choiceId":"exact offered id","reason":"brief strategic reason"}.',
        },
        {
          role: "user",
          content: JSON.stringify({
            strategy: request.strategyPrompt,
            seat: request.myPlayerSlot,
            legalChoices: [
              ...(prompt.input.type === "chooseAction"
                ? [
                    {
                      id: PASS_CHOICE_ID,
                      type: "pass",
                      label: "Pass priority",
                    },
                  ]
                : []),
              ...actions,
            ],
            promptType: prompt.input.type,
            gameState: gameView,
          }),
        },
      ],
    }),
    signal: request.signal,
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `AI endpoint returned HTTP ${response.status}.`,
    );
  }

  const content = chatText(payload.choices?.[0]?.message?.content);
  if (!content) throw new Error("AI response did not contain a message.");

  const parsed = parseDecision(content, choices);
  const choice: WorkbenchChoice =
    parsed.choiceId === PASS_CHOICE_ID
      ? { kind: "pass" }
      : { kind: "action", actionId: parsed.choiceId };

  return {
    promptId: prompt.promptId,
    choice,
    reason: parsed.reason,
    model: request.model.trim(),
    createdAt: Date.now(),
  };
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter an OpenAI-compatible API base URL.");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function chatText(content: ChatContent | undefined): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function parseDecision(
  content: string,
  allowedChoiceIds: string[],
): { choiceId: string; reason: string } {
  const direct = content.trim();
  if (allowedChoiceIds.includes(direct)) {
    return { choiceId: direct, reason: "Model selected this legal action." };
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AI did not return the required JSON decision.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("AI returned malformed JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned an invalid decision object.");
  }

  const value = parsed as { choiceId?: unknown; reason?: unknown };
  if (typeof value.choiceId !== "string" || !allowedChoiceIds.includes(value.choiceId)) {
    throw new Error("AI selected an action that was not offered by the rules engine.");
  }

  return {
    choiceId: value.choiceId,
    reason:
      typeof value.reason === "string" && value.reason.trim()
        ? value.reason.trim()
        : "Model selected this legal action.",
  };
}
