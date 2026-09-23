import type { Prompt, PromptOutput } from "@/protocol";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { GameLogEntry } from "@/types/gameLog";
import type { WorkbenchAuditEntry, WorkbenchRecommendation } from "@/stores/useWorkbenchStore";

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord | null {
  return value && typeof value === "object" ? (value as AnyRecord) : null;
}

function actionRecord(value: unknown): AnyRecord | null {
  const valueRecord = record(value);
  return valueRecord && typeof valueRecord.id === "string" ? valueRecord : null;
}

export function isManaManagementAction(action: unknown): boolean {
  const value = actionRecord(action);
  if (!value) return false;
  if (value.type === "undoMana") return true;
  if (value.type === "activateManaAbility") return true;
  if (value.type === "activateAbility" && value.isManaAbility === true) return true;
  if (
    (value.type === "useResource" || value.type === "releaseResource") &&
    (value.resource === "waterbend" || value.resource === "delve" || value.resource === "improvise")
  ) {
    return true;
  }
  return false;
}

export function chooseActionHasOnlyManaManagement(prompt: Prompt): boolean {
  if (prompt.input.type !== "chooseAction") return false;
  return prompt.input.actions.length > 0 && prompt.input.actions.every(isManaManagementAction);
}

export function promptForWorkbenchModel(prompt: Prompt): Prompt {
  if (prompt.input.type !== "chooseAction") return prompt;
  const strategicActions = prompt.input.actions.filter((action) => !isManaManagementAction(action));
  if (strategicActions.length === 0 || strategicActions.length === prompt.input.actions.length) {
    return prompt;
  }
  return {
    ...prompt,
    input: {
      ...prompt.input,
      actions: strategicActions,
    },
  } as Prompt;
}

interface ManaRequirement {
  generic: number;
  colored: Record<string, number>;
  total: number;
}

function parseSimpleManaCost(manaCost: string): ManaRequirement | null {
  const symbols = [...manaCost.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]?.trim() ?? "");
  if (symbols.length === 0) return null;

  let generic = 0;
  const colored: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const symbol of symbols) {
    if (/^\d+$/.test(symbol)) {
      generic += Number(symbol);
      continue;
    }
    if (symbol in colored) {
      colored[symbol] += 1;
      continue;
    }
    // Hybrid, phyrexian, X, snow, alternate resources, and other unusual
    // symbols stay model-controlled until Workbench has a dedicated solver.
    return null;
  }

  return {
    generic,
    colored,
    total: generic + Object.values(colored).reduce((sum, count) => sum + count, 0),
  };
}

interface ManaActionCandidate {
  actionId: string;
  colors: string[];
  amount: number;
}

export interface DeterministicManaPlan {
  output: PromptOutput["output"];
  preferredColor: string | null;
}

function manaActionCandidates(
  prompt: Prompt,
  gameView: ClientGameView,
  playerId: string | null,
): ManaActionCandidate[] {
  if (prompt.input.type !== "payManaCost") return [];
  const visibleSources = estimateManaAvailability(gameView, playerId ?? undefined).untappedSources;

  return prompt.input.actions.flatMap((rawAction) => {
    const action = actionRecord(rawAction);
    if (!action) return [];
    const isMana =
      action.type === "activateManaAbility" ||
      (action.type === "activateAbility" && action.isManaAbility === true);
    if (!isMana) return [];

    const produced = Array.isArray(action.producedMana)
      ? action.producedMana
          .map(record)
          .filter((item): item is AnyRecord => item != null)
          .filter(
            (item) =>
              typeof item.color === "string" &&
              ["W", "U", "B", "R", "G", "C"].includes(item.color) &&
              typeof item.amount === "number" &&
              item.amount > 0,
          )
      : [];

    if (produced.length === 1) {
      return [{
        actionId: action.id as string,
        colors: [produced[0].color as string],
        amount: produced[0].amount as number,
      }];
    }

    const cardId = typeof action.cardId === "string" ? action.cardId : null;
    const flexible = cardId ? visibleSources.find((source) => source.id === cardId) : null;
    if (!flexible || flexible.colors.length === 0 || flexible.amount <= 0) return [];

    return [{
      actionId: action.id as string,
      colors: flexible.colors,
      amount: flexible.amount,
    }];
  });
}

export function chooseDeterministicManaPlan(
  prompt: Prompt,
  gameView: ClientGameView,
  playerId: string | null,
): DeterministicManaPlan | null {
  if (prompt.input.type !== "payManaCost" || prompt.input.canConfirmFromPool) return null;
  const requirement = parseSimpleManaCost(prompt.input.manaCost);
  if (!requirement) return null;
  const player = gameView.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;

  const pool = player.manaPool as Record<string, number>;
  const candidates = manaActionCandidates(prompt, gameView, playerId);
  if (candidates.length === 0) return null;

  const coloredDeficits = ["W", "U", "B", "R", "G", "C"]
    .map((color) => ({
      color,
      needed: Math.max(0, requirement.colored[color] - (pool[color] ?? 0)),
    }))
    .filter((item) => item.needed > 0);

  for (const deficit of coloredDeficits) {
    const fixed = candidates.find(
      (item) => item.colors.length === 1 && item.colors[0] === deficit.color,
    );
    if (fixed) {
      return {
        output: { type: "act", actionId: fixed.actionId },
        preferredColor: null,
      };
    }
  }

  // A flexible source is deterministic only when exactly one colored deficit
  // remains. This covers Command Tower-style "choose a color" plumbing without
  // making strategic choices between multiple needed colors.
  if (coloredDeficits.length === 1) {
    const { color } = coloredDeficits[0];
    const flexible = candidates.find(
      (item) => item.colors.length > 1 && item.colors.includes(color),
    );
    if (flexible) {
      return {
        output: { type: "act", actionId: flexible.actionId },
        preferredColor: color,
      };
    }
  } else if (coloredDeficits.length > 1) {
    return null;
  }

  const poolTotal = ["W", "U", "B", "R", "G", "C"].reduce(
    (sum, color) => sum + (pool[color] ?? 0),
    0,
  );
  if (poolTotal >= requirement.total) return null;

  const fixedCandidates = candidates.filter((item) => item.colors.length === 1);
  const surplusByColor = (color: string) =>
    (pool[color] ?? 0) - (requirement.colored[color] ?? 0);
  const fixed = [...fixedCandidates].sort((a, b) => {
    const aColor = a.colors[0];
    const bColor = b.colors[0];
    const aScore = aColor === "C" ? 100 : Math.max(0, surplusByColor(aColor));
    const bScore = bColor === "C" ? 100 : Math.max(0, surplusByColor(bColor));
    return bScore - aScore;
  })[0];
  if (fixed) {
    return {
      output: { type: "act", actionId: fixed.actionId },
      preferredColor: null,
    };
  }

  // For a purely generic remainder, any color from a flexible source is
  // equivalent because the mana is immediately spent on this payment.
  const flexible = candidates.find((item) => item.colors.length > 1);
  if (flexible) {
    return {
      output: { type: "act", actionId: flexible.actionId },
      preferredColor: flexible.colors[0] ?? null,
    };
  }

  return null;
}

export function chooseDeterministicManaStep(
  prompt: Prompt,
  gameView: ClientGameView,
  playerId: string | null,
): PromptOutput["output"] | null {
  return chooseDeterministicManaPlan(prompt, gameView, playerId)?.output ?? null;
}

function estimateManaAvailability(
  gameView: ClientGameView,
  decidingPlayerId?: string,
): WorkbenchDecisionContext["manaAvailability"] {
  const playerId =
    decidingPlayerId ?? gameView.priorityPlayerId ?? gameView.activePlayerId ?? gameView.players[0]?.id;
  const player = gameView.players.find((candidate) => candidate.id === playerId) ?? gameView.players[0];
  const pool = { ...((player?.manaPool ?? {}) as Record<string, number>) };
  const commanderColors = new Set<string>();
  for (const card of player?.commandZone ?? []) {
    const identityHints = `${String(card.color ?? "")}${String(card.manaCost ?? "")}`;
    for (const color of identityHints.match(/[WUBRG]/g) ?? []) {
      commanderColors.add(color);
    }
  }

  const untappedSources = (gameView.battlefield ?? []).flatMap((card) => {
    if (card.controllerId !== player?.id || card.tapped) return [];
    if (card.types.includes("Creature") && card.summoningSick) return [];
    const text = card.text ?? "";
    if (!/\{T\}.*Add|Add .*mana/i.test(text)) return [];

    if (/one mana of any color in your commander's color identity/i.test(text)) {
      const colors = [...commanderColors];
      return colors.length
        ? [{ id: card.id, name: card.identity.name, colors, amount: 1 }]
        : [];
    }
    if (/one mana of any color/i.test(text)) {
      return [
        {
          id: card.id,
          name: card.identity.name,
          colors: ["W", "U", "B", "R", "G"],
          amount: 1,
        },
      ];
    }

    const addClauses = [...text.matchAll(/Add\s+([^.;\n]+)/gi)].map((match) => match[1] ?? "");
    const symbols = addClauses.flatMap((clause) =>
      [...clause.matchAll(/\{([WUBRGC])\}/g)].map((match) => match[1] ?? ""),
    );
    const colors = [...new Set(symbols.filter(Boolean))];
    if (colors.length === 0) return [];
    const hasAlternative = addClauses.some((clause) => /\bor\b/i.test(clause));
    const amount = hasAlternative ? 1 : Math.max(1, symbols.length);
    return [{ id: card.id, name: card.identity.name, colors, amount }];
  });

  return { pool, untappedSources };
}

function auditTurn(entry: WorkbenchAuditEntry): number | null {
  const state = record(entry.visibleGameState);
  return typeof state?.turn === "number" ? state.turn : null;
}

function auditStep(entry: WorkbenchAuditEntry): string | null {
  const state = record(entry.visibleGameState);
  return typeof state?.step === "string" ? state.step : null;
}

function selectedAction(entry: WorkbenchAuditEntry): AnyRecord | null {
  const output = record(entry.output);
  if (output?.type !== "act" || typeof output.actionId !== "string") return null;
  const prompt = record(entry.promptSnapshot);
  const input = record(prompt?.input);
  const actions = Array.isArray(input?.actions) ? input.actions : [];
  return (
    actions
      .map(actionRecord)
      .find((action) => action?.id === output.actionId) ?? null
  );
}

function actionLabel(action: AnyRecord | null): string | null {
  if (!action) return null;
  if (typeof action.label === "string") return action.label;
  if (typeof action.description === "string") return action.description;
  return typeof action.type === "string" ? action.type : null;
}

function sourceCardName(entry: WorkbenchAuditEntry): string | null {
  const prompt = record(entry.promptSnapshot);
  const sourceCard = record(prompt?.sourceCard);
  const identity = record(sourceCard?.identity);
  return typeof identity?.name === "string" ? identity.name : null;
}

export interface WorkbenchDecisionContext {
  currentTurn: number;
  currentStep: string;
  manaAvailability: {
    pool: Record<string, number>;
    untappedSources: Array<{
      id: string;
      name: string;
      colors: string[];
      amount: number;
    }>;
  };
  strategicFacts: {
    isActivePlayer: boolean;
    landsInHand: number;
    landDropsRemaining: number;
    opponents: Array<{
      id: string;
      life: number;
      visibleUntappedCreatures: number;
    }>;
  };
  recentEngineLog: Array<Pick<GameLogEntry, "message" | "entryType" | "playerId" | "cardId">>;
  recentDecisions: Array<{
    turn: number | null;
    step: string | null;
    source: string;
    promptType: string;
    action: string | null;
    output: unknown;
    reason: string | null;
    error: string | null;
  }>;
  castActionsChosenThisTurn: string[];
  spellsActuallyCastThisTurn: string[];
  secondSpellAlreadyCast: boolean;
  currentTransaction: {
    initiatedAction: string | null;
    sourceCard: string | null;
    steps: Array<{
      promptType: string;
      output: unknown;
      reason: string | null;
    }>;
  } | null;
  selectionCostHints: {
    sourceCard: string | null;
    baseManaCost: string | null;
    options: Array<{
      index: number;
      label: string | null;
      additionalCost: string | null;
    }>;
  } | null;
  recentFailedPayments: Array<{
    card: string | null;
    reason: string | null;
  }>;
  guidance: string[];
}

export function countRepeatedSamePromptDecision(
  history: WorkbenchRecommendation[],
  recommendation: WorkbenchRecommendation,
): number {
  return history
    .slice(-3)
    .filter(
      (item) =>
        item.gameId === recommendation.gameId &&
        item.promptId === recommendation.promptId &&
        item.promptFingerprint === recommendation.promptFingerprint &&
        JSON.stringify(item.output) === JSON.stringify(recommendation.output),
    ).length;
}

export function buildWorkbenchDecisionContext(args: {
  auditLog: WorkbenchAuditEntry[];
  gameView: ClientGameView;
  gameLog: GameLogEntry[];
  currentPrompt?: Prompt;
}): WorkbenchDecisionContext {
  const { auditLog, gameView, gameLog, currentPrompt } = args;
  const sameGame = auditLog.filter((entry) => entry.gameId === gameView.gameId);
  const recent = sameGame.slice(-12);
  const currentTurnEntries = sameGame.filter((entry) => auditTurn(entry) === gameView.turn);

  const castActionsChosenThisTurn = currentTurnEntries.flatMap((entry) => {
    const action = selectedAction(entry);
    if (action?.type !== "cast") return [];
    return [actionLabel(action) ?? sourceCardName(entry) ?? "cast spell"];
  });

  let selectionCostHints: WorkbenchDecisionContext["selectionCostHints"] = null;
  if (currentPrompt?.input.type === "chooseFromSelection") {
    const promptRecord = record(currentPrompt);
    const sourceCard = record(promptRecord?.sourceCard);
    const identity = record(sourceCard?.identity);
    const sourceAbilityText =
      typeof promptRecord?.sourceAbilityText === "string" ? promptRecord.sourceAbilityText : "";
    const additionalCosts = sourceAbilityText
      .split(/\r?\n/)
      .map((line) => line.match(/^\+\s*((?:\{[^}]+\})+)\s*[—-]/)?.[1] ?? null);

    selectionCostHints = {
      sourceCard: typeof identity?.name === "string" ? identity.name : null,
      baseManaCost: typeof sourceCard?.manaCost === "string" ? sourceCard.manaCost : null,
      options: currentPrompt.input.options.map((option, index) => ({
        index,
        label: typeof option.label === "string" ? option.label : null,
        additionalCost: additionalCosts[index] ?? null,
      })),
    };
  }

  let currentTransaction: WorkbenchDecisionContext["currentTransaction"] = null;
  const transactionFollowUps = new Set([
    "payManaCost",
    "chooseBoolean",
    "chooseFromSelection",
    "chooseBoardTargets",
    "chooseCards",
    "chooseColor",
    "chooseNumber",
    "scry",
    "reorder",
  ]);
  if (currentPrompt && transactionFollowUps.has(currentPrompt.input.type)) {
    const transactionStart = [...currentTurnEntries]
      .reverse()
      .find((entry) => {
        if (entry.promptType !== "chooseAction") return false;
        const action = selectedAction(entry);
        return !!action && !isManaManagementAction(action);
      });
    if (transactionStart) {
      const startIndex = sameGame.findIndex((entry) => entry.id === transactionStart.id);
      const transactionEntries =
        startIndex >= 0 ? sameGame.slice(startIndex).slice(-10) : [transactionStart];
      currentTransaction = {
        initiatedAction: actionLabel(selectedAction(transactionStart)),
        sourceCard: sourceCardName(transactionStart),
        steps: transactionEntries.map((entry) => ({
          promptType: entry.promptType,
          output: entry.output,
          reason: entry.reason,
        })),
      };
    }
  }

  const recentFailedPayments = currentTurnEntries
    .filter((entry) => {
      const output = record(entry.output);
      return entry.promptType === "payManaCost" && output?.type === "cancel";
    })
    .slice(-4)
    .map((entry) => ({
      card: sourceCardName(entry),
      reason: entry.reason,
    }));

  const turnStartMs =
    currentTurnEntries.length > 0
      ? Math.min(...currentTurnEntries.map((entry) => entry.createdAt))
      : 0;
  const spellsActuallyCastThisTurn = gameLog
    .filter((entry) => entry.timestampMs >= turnStartMs)
    .flatMap((entry) => {
      const match = entry.message.match(/^(?:Cast|Cascade cast):\s*(.+)$/i);
      return match?.[1] ? [match[1]] : [];
    });

  const decidingPlayerId =
    currentPrompt?.decidingPlayerId ??
    gameView.priorityPlayerId ??
    gameView.activePlayerId ??
    gameView.players[0]?.id;
  const decidingPlayer =
    gameView.players.find((player) => player.id === decidingPlayerId) ?? gameView.players[0];
  const strategicFacts: WorkbenchDecisionContext["strategicFacts"] = {
    isActivePlayer: decidingPlayer?.id === gameView.activePlayerId,
    landsInHand:
      (decidingPlayer?.hand ?? []).filter((card) => card.types.includes("Land")).length,
    landDropsRemaining: Math.max(
      0,
      (decidingPlayer?.maxLandPlaysPerTurn ?? 0) - (decidingPlayer?.landsPlayedThisTurn ?? 0),
    ),
    opponents: gameView.players
      .filter((player) => player.id !== decidingPlayer?.id)
      .map((player) => ({
        id: player.id,
        life: player.life,
        visibleUntappedCreatures: (gameView.battlefield ?? []).filter(
          (card) =>
            card.controllerId === player.id &&
            card.types.includes("Creature") &&
            !card.tapped,
        ).length,
      })),
  };

  return {
    currentTurn: gameView.turn,
    currentStep: gameView.step,
    manaAvailability: estimateManaAvailability(gameView, currentPrompt?.decidingPlayerId),
    strategicFacts,
    recentEngineLog: gameLog.slice(-24).map((entry) => ({
      message: entry.message,
      entryType: entry.entryType,
      playerId: entry.playerId,
      cardId: entry.cardId,
    })),
    recentDecisions: recent.map((entry) => ({
      turn: auditTurn(entry),
      step: auditStep(entry),
      source: entry.source,
      promptType: entry.promptType,
      action: actionLabel(selectedAction(entry)) ?? sourceCardName(entry),
      output: entry.output,
      reason: entry.reason,
      error: entry.error,
    })),
    castActionsChosenThisTurn,
    spellsActuallyCastThisTurn,
    secondSpellAlreadyCast: spellsActuallyCastThisTurn.length >= 2,
    currentTransaction,
    selectionCostHints,
    recentFailedPayments,
    guidance: [
      "Treat recent decisions and engine log entries as continuity from this same game, not as hypothetical examples.",
      "Use strategicFacts for basic counts and turn-state facts instead of recounting or inferring them from prose. Do not claim there are no blockers when visibleUntappedCreatures is nonzero.",
      "When currentTransaction is present, continue the action you already initiated. Tapped/sacrificed/payment state may be the result of costs you intentionally paid.",
      "Outside the same multi-step transaction, re-evaluate every currently legal strategic option from the present game state. Do not continue a prior plan merely because an earlier decision intended it.",
      "Use manaAvailability as a highlighted estimate of the mana currently available without sacrificing cards; flexible sources list every color they can make.",
      "If selectionCostHints is present, add the source card's baseManaCost to every selected additionalCost before judging affordability.",
      "If a payment attempt just failed, do not repeat the identical transaction unless resources changed; choose a cheaper mode or a different action.",
      "Workbench normally handles mechanical mana production during payManaCost. Do not float mana during ordinary priority without a concrete reason.",
      "Use spellsActuallyCastThisTurn as the authoritative spell-count continuity for this turn. Do not call a later spell the second spell if two spells are already listed.",
    ],
  };
}
