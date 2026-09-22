import type { Prompt, PromptOutput } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { WorkbenchRecommendation } from "@/stores/useWorkbenchStore";
import { classifyWorkbenchDecision } from "./decisionImportance";
import { compactWorkbenchGameView } from "./compactGameView";

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

interface ModelDecision {
  output: unknown;
  reason?: unknown;
}

const AI_PROMPT_TYPES = new Set([
  "mulligan",
  "mulliganPutBack",
  "chooseAction",
  "chooseAttackers",
  "chooseBlockers",
  "chooseBoardTargets",
  "chooseBoolean",
  "chooseFromSelection",
  "scry",
  "chooseColor",
  "chooseNumber",
  "chooseDamageAssignmentOrder",
  "chooseCombatDamageAssignment",
  "payManaCost",
  "chooseCards",
  "reorder",
]);

export function isWorkbenchAiPrompt(prompt: Prompt | null): boolean {
  return !!prompt && AI_PROMPT_TYPES.has(prompt.input.type);
}

export async function requestWorkbenchDecision(
  request: WorkbenchAiRequest,
): Promise<WorkbenchRecommendation> {
  const { prompt, gameView } = request;
  const startedAt = performance.now();
  const classification = classifyWorkbenchDecision(prompt);
  if (!isWorkbenchAiPrompt(prompt)) {
    throw new Error(`Thinking AI does not support ${prompt.input.type}.`);
  }
  if (!request.model.trim()) throw new Error("Choose an AI model first.");

  const endpoint = chatCompletionsEndpoint(request.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(request.apiKey?.trim()
        ? { Authorization: `Bearer ${request.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: request.model.trim(),
      ...(request.baseUrl.trim().startsWith("/workbench-ai")
        ? { workbenchImportance: classification.importance }
        : {}),
      messages: [
        {
          role: "system",
          content:
            "You are piloting a Magic: The Gathering deck inside a deterministic rules engine. " +
            "Use only the visible game state and the current engine prompt. Never invent cards, " +
            "hidden information, targets, action IDs, or other choices. Return JSON only with the " +
            "shape {\"output\": <prompt response>, \"reason\": \"brief strategic reason\"}. " +
            "The output must satisfy the exact response rules supplied by the user message.",
        },
        {
          role: "user",
          content: JSON.stringify({
            strategy: request.strategyPrompt,
            seat: request.myPlayerSlot,
            responseRules: responseRules(prompt),
            prompt,
            visibleGameState: compactWorkbenchGameView(gameView),
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

  const parsed = parseJsonDecision(content);
  const output = validatePromptOutput(prompt, parsed.output);
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "Model selected a validated legal response.";

  return {
    promptId: Number(prompt.promptId ?? 0),
    output,
    label: describeOutput(output),
    reason,
    model: request.model.trim(),
    promptType: prompt.input.type,
    importance: classification.importance,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    createdAt: Date.now(),
  };
}

function responseRules(prompt: Prompt): string[] {
  switch (prompt.input.type) {
    case "chooseAction":
      return [
        'Return {"type":"act","actionId":"<one id from prompt.input.actions>"} or {"type":"pass","exhaustStack":false}.',
        "Do not use restoreSnapshot.",
      ];
    case "payManaCost":
      return [
        'Return {"type":"act","actionId":"<one id from prompt.input.actions>"}, {"type":"pay","auto":true|false}, or {"type":"cancel"}.',
      ];
    case "mulligan":
      return ['Return {"type":"mulliganDecision","keep":true|false}.'];
    case "mulliganPutBack":
      return [
        'Return {"type":"mulliganPutBackDecision","cardIds":[...]} with exactly prompt.input.count unique IDs from prompt.input.handCardIds.',
      ];
    case "chooseAttackers":
      return [
        'Return {"type":"declareAttackers","assignments":[{"attackerId":"...","targetId":"..."}]}.',
        "Each attacker can appear at most once. Each targetId must be valid for that attacker.",
        "Include every mustAttack attacker that has at least one valid target.",
      ];
    case "chooseBlockers":
      return [
        'Return {"type":"declareBlockers","assignments":[{"blockerId":"...","attackerId":"..."}]}.',
        "Each blocker can appear at most once and must be in that attacker's validBlockerIds.",
        "Respect minBlockers, maxBlockers, and mustBeBlocked.",
      ];
    case "chooseBoardTargets":
      return [
        'Return {"type":"boardTargets","chosen":[<zero or one exact object from prompt.input.candidates>]} or {"type":"cancel"} if cancellable.',
        "Choose one target at a time. Use [] only when the current chosenTargets already satisfies minTargets.",
      ];
    case "chooseBoolean":
      return ['Return {"type":"decision","value":true|false}.'];
    case "chooseFromSelection":
      return [
        'Return {"type":"selectionDecision","chosenIndices":[...]} using zero-based indices into prompt.input.options.',
        "The sum of option weights must be between minTotal and maxTotal. Repeat an index only when that option canRepeat.",
      ];
    case "chooseCards":
      return [
        'Return {"type":"chooseCardsDecision","chosenCardIds":[...]} using unique IDs from prompt.input.cards.',
        "Choose between prompt.input.min and prompt.input.max cards.",
      ];
    case "chooseColor":
      return [
        'Return {"type":"colorDecision","chosenColors":{"W":1}} using only prompt.input.validColors.',
        "Counts must be nonnegative integers totaling prompt.input.amount. If repeatAllowed is false, each count is at most 1.",
      ];
    case "chooseNumber":
      return [
        'Return {"type":"numberDecision","chosenNumber":N} where N is an integer between min and max, or null only when declining is strategically intended.',
      ];
    case "scry":
      return [
        'Return {"type":"scryDecision","zoneCardIds":[[...], [...]]}.',
        "zoneCardIds has one array per prompt.input.zones entry, in the same order. Every prompt.input.cards ID must appear exactly once.",
      ];
    case "reorder":
      return [
        'Return {"type":"reorderDecision","orderedIds":[...]} as a permutation of every prompt.input.items[].id.',
      ];
    case "chooseDamageAssignmentOrder":
      return [
        'Return {"type":"damageAssignmentOrderDecision","orderedBlockerIds":[...]} as a permutation of every blockerId.',
      ];
    case "chooseCombatDamageAssignment":
      return [
        'Return {"type":"combatDamageAssignmentDecision","assignments":[{"assigneeId":"...","damage":N}]}.',
        "Assignee IDs may be blockerIds and defenderId when present. Damage values must be nonnegative integers totaling totalDamage.",
      ];
    default:
      return ["Return the exact response object required by the current prompt."];
  }
}

function validatePromptOutput(prompt: Prompt, value: unknown): PromptOutput["output"] {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("AI output was not a prompt response object.");
  }

  switch (prompt.input.type) {
    case "chooseAction": {
      if (value.type === "pass") {
        return { type: "pass", until: undefined, exhaustStack: value.exhaustStack === true };
      }
      if (value.type !== "act" || typeof value.actionId !== "string") {
        throw new Error("AI returned an invalid chooseAction response.");
      }
      if (!prompt.input.actions.some((action) => action.id === value.actionId)) {
        throw new Error("AI selected an action ID the rules engine did not offer.");
      }
      return { type: "act", actionId: value.actionId };
    }

    case "payManaCost": {
      if (value.type === "cancel") return { type: "cancel" };
      if (value.type === "pay") return { type: "pay", auto: value.auto === true };
      if (
        value.type === "act" &&
        typeof value.actionId === "string" &&
        prompt.input.actions.some((action) => action.id === value.actionId)
      ) {
        return { type: "act", actionId: value.actionId };
      }
      throw new Error("AI returned an invalid mana-payment response.");
    }

    case "mulligan":
      if (value.type === "mulliganDecision" && typeof value.keep === "boolean") {
        return { type: "mulliganDecision", keep: value.keep };
      }
      throw new Error("AI returned an invalid mulligan response.");

    case "mulliganPutBack": {
      if (value.type !== "mulliganPutBackDecision" || !stringArray(value.cardIds)) {
        throw new Error("AI returned an invalid mulligan put-back response.");
      }
      const ids = unique(value.cardIds);
      const allowed = new Set(prompt.input.handCardIds);
      if (ids.length !== prompt.input.count || ids.some((id) => !allowed.has(id))) {
        throw new Error("AI chose an invalid set of cards to put back.");
      }
      return { type: "mulliganPutBackDecision", cardIds: ids };
    }

    case "chooseAttackers": {
      if (value.type !== "declareAttackers" || !Array.isArray(value.assignments)) {
        throw new Error("AI returned an invalid attacker declaration.");
      }
      const assignments = value.assignments.map((raw) => {
        if (!isRecord(raw) || typeof raw.attackerId !== "string" || typeof raw.targetId !== "string") {
          throw new Error("AI returned a malformed attack assignment.");
        }
        return { attackerId: raw.attackerId, targetId: raw.targetId };
      });
      if (unique(assignments.map((item) => item.attackerId)).length !== assignments.length) {
        throw new Error("AI assigned the same attacker more than once.");
      }
      for (const assignment of assignments) {
        const option = prompt.input.attackers.find(
          (attacker) => attacker.attackerId === assignment.attackerId,
        );
        if (!option || !option.validTargetIds.includes(assignment.targetId)) {
          throw new Error("AI chose an illegal attack target.");
        }
      }
      for (const option of prompt.input.attackers) {
        if (
          option.mustAttack &&
          option.validTargetIds.length > 0 &&
          !assignments.some((item) => item.attackerId === option.attackerId)
        ) {
          throw new Error("AI omitted a creature that must attack.");
        }
      }
      return { type: "declareAttackers", assignments };
    }

    case "chooseBlockers": {
      if (value.type !== "declareBlockers" || !Array.isArray(value.assignments)) {
        throw new Error("AI returned an invalid blocker declaration.");
      }
      const assignments = value.assignments.map((raw) => {
        if (!isRecord(raw) || typeof raw.blockerId !== "string" || typeof raw.attackerId !== "string") {
          throw new Error("AI returned a malformed block assignment.");
        }
        return { blockerId: raw.blockerId, attackerId: raw.attackerId };
      });
      if (unique(assignments.map((item) => item.blockerId)).length !== assignments.length) {
        throw new Error("AI assigned the same blocker more than once.");
      }
      for (const assignment of assignments) {
        const attacker = prompt.input.attackers.find(
          (option) => option.attackerId === assignment.attackerId,
        );
        if (!attacker || !attacker.validBlockerIds.includes(assignment.blockerId)) {
          throw new Error("AI chose an illegal blocker.");
        }
      }
      for (const attacker of prompt.input.attackers) {
        const count = assignments.filter((item) => item.attackerId === attacker.attackerId).length;
        if (count > 0 && count < attacker.minBlockers) {
          throw new Error("AI did not satisfy the attacker's minimum blocker requirement.");
        }
        if (attacker.maxBlockers != null && count > attacker.maxBlockers) {
          throw new Error("AI exceeded the attacker's maximum blocker count.");
        }
        if (attacker.mustBeBlocked && attacker.validBlockerIds.length > 0 && count === 0) {
          throw new Error("AI left an attacker unblocked that must be blocked.");
        }
      }
      return { type: "declareBlockers", assignments };
    }

    case "chooseBoardTargets": {
      if (value.type === "cancel") {
        if (!prompt.input.cancellable) throw new Error("This target selection cannot be cancelled.");
        return { type: "cancel" };
      }
      if (value.type !== "boardTargets" || !Array.isArray(value.chosen) || value.chosen.length > 1) {
        throw new Error("AI returned an invalid target response.");
      }
      if (value.chosen.length === 0) {
        if (prompt.input.chosenTargets < prompt.input.minTargets) {
          throw new Error("AI stopped targeting before the minimum target count.");
        }
        return { type: "boardTargets", chosen: [] };
      }
      const raw = value.chosen[0];
      if (!isRecord(raw) || typeof raw.kind !== "string" || typeof raw.id !== "string") {
        throw new Error("AI returned a malformed target.");
      }
      const candidate = prompt.input.candidates.find(
        (target) => target.kind === raw.kind && target.id === raw.id,
      );
      if (!candidate) throw new Error("AI selected a target the engine did not offer.");
      return { type: "boardTargets", chosen: [candidate] };
    }

    case "chooseBoolean":
      if (value.type === "decision" && typeof value.value === "boolean") {
        return { type: "decision", value: value.value };
      }
      throw new Error("AI returned an invalid yes/no decision.");

    case "chooseFromSelection": {
      if (value.type !== "selectionDecision" || !numberArray(value.chosenIndices)) {
        throw new Error("AI returned an invalid selection.");
      }
      const indices = value.chosenIndices;
      let total = 0;
      const seen = new Map<number, number>();
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= prompt.input.options.length) {
          throw new Error("AI selected an option index that does not exist.");
        }
        const option = prompt.input.options[index];
        const count = (seen.get(index) ?? 0) + 1;
        seen.set(index, count);
        if (count > 1 && !option.canRepeat) {
          throw new Error("AI repeated an option that cannot be repeated.");
        }
        total += option.weight;
      }
      if (total < prompt.input.minTotal || total > prompt.input.maxTotal) {
        throw new Error("AI selection does not satisfy the required total.");
      }
      return { type: "selectionDecision", chosenIndices: indices };
    }

    case "chooseCards": {
      if (value.type !== "chooseCardsDecision" || !stringArray(value.chosenCardIds)) {
        throw new Error("AI returned an invalid card choice.");
      }
      const ids = unique(value.chosenCardIds);
      const allowed = new Set(prompt.input.cards.map((card) => card.id));
      if (
        ids.length < prompt.input.min ||
        ids.length > prompt.input.max ||
        ids.some((id) => !allowed.has(id))
      ) {
        throw new Error("AI chose cards outside the engine's legal range.");
      }
      return { type: "chooseCardsDecision", chosenCardIds: ids };
    }

    case "chooseColor": {
      if (value.type !== "colorDecision" || !isRecord(value.chosenColors)) {
        throw new Error("AI returned an invalid color choice.");
      }
      const allowed = new Set(prompt.input.validColors);
      const chosenColors: Record<string, number> = {};
      let total = 0;
      for (const [color, rawCount] of Object.entries(value.chosenColors)) {
        if (!allowed.has(color) || !Number.isInteger(rawCount) || (rawCount as number) < 0) {
          throw new Error("AI returned an illegal color allocation.");
        }
        const count = rawCount as number;
        if (!prompt.input.repeatAllowed && count > 1) {
          throw new Error("AI repeated a color when repetition is not allowed.");
        }
        if (count > 0) chosenColors[color] = count;
        total += count;
      }
      if (total !== prompt.input.amount) {
        throw new Error("AI color allocation has the wrong total.");
      }
      return { type: "colorDecision", chosenColors };
    }

    case "chooseNumber": {
      if (value.type !== "numberDecision") throw new Error("AI returned an invalid number choice.");
      if (value.chosenNumber === null) return { type: "numberDecision", chosenNumber: null };
      if (
        typeof value.chosenNumber !== "number" ||
        !Number.isInteger(value.chosenNumber) ||
        value.chosenNumber < prompt.input.min ||
        value.chosenNumber > prompt.input.max
      ) {
        throw new Error("AI chose a number outside the legal range.");
      }
      return { type: "numberDecision", chosenNumber: value.chosenNumber };
    }

    case "scry": {
      if (value.type !== "scryDecision" || !Array.isArray(value.zoneCardIds)) {
        throw new Error("AI returned an invalid scry decision.");
      }
      if (
        value.zoneCardIds.length !== prompt.input.zones.length ||
        value.zoneCardIds.some((zone) => !stringArray(zone))
      ) {
        throw new Error("AI scry output does not match the available destinations.");
      }
      const zones = value.zoneCardIds as string[][];
      const flattened = zones.flat();
      const expected = prompt.input.cards.map((card) => card.id);
      if (!sameSet(flattened, expected) || unique(flattened).length !== flattened.length) {
        throw new Error("AI scry output must place every card exactly once.");
      }
      return { type: "scryDecision", zoneCardIds: zones };
    }

    case "reorder": {
      if (value.type !== "reorderDecision" || !stringArray(value.orderedIds)) {
        throw new Error("AI returned an invalid reorder decision.");
      }
      const expected = prompt.input.items.map((item) => item.id);
      if (!sameSet(value.orderedIds, expected) || unique(value.orderedIds).length !== expected.length) {
        throw new Error("AI reorder output is not a complete permutation.");
      }
      return { type: "reorderDecision", orderedIds: value.orderedIds };
    }

    case "chooseDamageAssignmentOrder": {
      if (value.type !== "damageAssignmentOrderDecision" || !stringArray(value.orderedBlockerIds)) {
        throw new Error("AI returned an invalid damage order.");
      }
      if (
        !sameSet(value.orderedBlockerIds, prompt.input.blockerIds) ||
        unique(value.orderedBlockerIds).length !== prompt.input.blockerIds.length
      ) {
        throw new Error("AI damage order is not a complete blocker permutation.");
      }
      return { type: "damageAssignmentOrderDecision", orderedBlockerIds: value.orderedBlockerIds };
    }

    case "chooseCombatDamageAssignment": {
      if (value.type !== "combatDamageAssignmentDecision" || !Array.isArray(value.assignments)) {
        throw new Error("AI returned an invalid combat damage assignment.");
      }
      const allowed = new Set([
        ...prompt.input.blockerIds,
        ...(prompt.input.defenderId ? [prompt.input.defenderId] : []),
      ]);
      const assignments = value.assignments.map((raw) => {
        if (
          !isRecord(raw) ||
          typeof raw.assigneeId !== "string" ||
          typeof raw.damage !== "number" ||
          !Number.isInteger(raw.damage) ||
          raw.damage < 0 ||
          !allowed.has(raw.assigneeId)
        ) {
          throw new Error("AI returned a malformed combat damage entry.");
        }
        return { assigneeId: raw.assigneeId, damage: raw.damage };
      });
      if (unique(assignments.map((item) => item.assigneeId)).length !== assignments.length) {
        throw new Error("AI assigned combat damage to the same object more than once.");
      }
      const total = assignments.reduce((sum, item) => sum + item.damage, 0);
      if (total !== prompt.input.totalDamage) {
        throw new Error("AI combat damage assignment does not use the exact available damage.");
      }
      return { type: "combatDamageAssignmentDecision", assignments };
    }

    default:
      throw new Error(`Thinking AI does not support ${prompt.input.type}.`);
  }
}

function describeOutput(output: PromptOutput["output"]): string {
  switch (output.type) {
    case "act":
      return `Action ${output.actionId}`;
    case "pass":
      return "Pass priority";
    case "pay":
      return output.auto ? "Auto-pay mana" : "Pay mana";
    case "cancel":
      return "Cancel";
    case "mulliganDecision":
      return output.keep ? "Keep hand" : "Mulligan";
    case "mulliganPutBackDecision":
      return `Put back ${output.cardIds.length} card(s)`;
    case "declareAttackers":
      return `Attack with ${output.assignments.length} creature(s)`;
    case "declareBlockers":
      return `Block with ${output.assignments.length} creature(s)`;
    case "boardTargets":
      return output.chosen.length ? `Choose target ${output.chosen[0].id}` : "Finish targeting";
    case "decision":
      return output.value ? "Yes" : "No";
    case "selectionDecision":
      return `Choose ${output.chosenIndices.length} selection(s)`;
    case "chooseCardsDecision":
      return `Choose ${output.chosenCardIds.length} card(s)`;
    case "colorDecision":
      return "Choose colors";
    case "numberDecision":
      return `Choose ${output.chosenNumber ?? "none"}`;
    case "scryDecision":
      return "Resolve scry";
    case "reorderDecision":
      return "Choose order";
    case "damageAssignmentOrderDecision":
      return "Choose damage order";
    case "combatDamageAssignmentDecision":
      return "Assign combat damage";
    default:
      return "Validated AI decision";
  }
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

function parseJsonDecision(content: string): ModelDecision {
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
  if (!isRecord(parsed) || !("output" in parsed)) {
    throw new Error("AI response is missing the output object.");
  }
  return parsed as unknown as ModelDecision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function numberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const l = new Set(left);
  const r = new Set(right);
  return l.size === r.size && [...l].every((item) => r.has(item));
}
