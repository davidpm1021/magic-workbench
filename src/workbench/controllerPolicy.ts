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

function compactPromptCard(card: AnyRecord): AnyRecord {
  const identity = record(card.identity);
  return {
    id: card.id,
    identity: {
      name: identity?.name,
    },
    zoneId: card.zoneId,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    manaCost: card.manaCost,
    cmc: card.cmc,
    types: card.types,
    subtypes: card.subtypes,
    power: card.power,
    toughness: card.toughness,
    text: card.text,
    keywords: card.keywords,
    counters: card.counters,
  };
}

export function promptForWorkbenchModel(prompt: Prompt): Prompt {
  if (prompt.input.type === "chooseAction") {
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

  if (prompt.input.type === "chooseCards") {
    return {
      ...prompt,
      input: {
        ...prompt.input,
        cards: prompt.input.cards.map((card) => compactPromptCard(card as unknown as AnyRecord)),
      },
    } as unknown as Prompt;
  }

  if (prompt.input.type === "scry") {
    return {
      ...prompt,
      input: {
        ...prompt.input,
        cards: prompt.input.cards.map((card) => compactPromptCard(card as unknown as AnyRecord)),
      },
    } as unknown as Prompt;
  }

  return prompt;
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


function combineSimpleManaCosts(costs: string[]): ManaRequirement | null {
  const combined: ManaRequirement = {
    generic: 0,
    colored: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    total: 0,
  };
  for (const cost of costs) {
    const parsed = parseSimpleManaCost(cost);
    if (!parsed) return null;
    combined.generic += parsed.generic;
    for (const color of ["W", "U", "B", "R", "G", "C"]) {
      combined.colored[color] += parsed.colored[color] ?? 0;
    }
    combined.total += parsed.total;
  }
  return combined;
}

function manaRequirementLabel(requirement: ManaRequirement): string {
  const parts: string[] = [];
  if (requirement.generic > 0) parts.push(`{${requirement.generic}}`);
  for (const color of ["W", "U", "B", "R", "G", "C"]) {
    for (let count = 0; count < (requirement.colored[color] ?? 0); count += 1) {
      parts.push(`{${color}}`);
    }
  }
  return parts.join("") || "{0}";
}

function normalizedPoolAmount(pool: Record<string, number>, color: string): number {
  const aliases: Record<string, string[]> = {
    W: ["W", "White"],
    U: ["U", "Blue"],
    B: ["B", "Black"],
    R: ["R", "Red"],
    G: ["G", "Green"],
    C: ["C", "Colorless"],
  };
  return (aliases[color] ?? [color]).reduce((sum, key) => sum + (pool[key] ?? 0), 0);
}

function canPaySimpleManaRequirement(
  requirement: ManaRequirement,
  availability: WorkbenchDecisionContext["manaAvailability"],
): boolean {
  const colors = ["W", "U", "B", "R", "G", "C"];
  const initial = Object.fromEntries(
    colors.map((color) => [color, Math.min(requirement.colored[color], normalizedPoolAmount(availability.pool, color))]),
  ) as Record<string, number>;
  const poolTotal = colors.reduce(
    (sum, color) => sum + normalizedPoolAmount(availability.pool, color),
    0,
  );
  const sources = availability.untappedSources;
  const memo = new Set<string>();

  const search = (index: number, colored: Record<string, number>, total: number): boolean => {
    const coloredSatisfied = colors.every(
      (color) => colored[color] >= (requirement.colored[color] ?? 0),
    );
    if (coloredSatisfied && total >= requirement.total) return true;
    if (index >= sources.length) return false;

    const cappedTotal = Math.min(total, requirement.total);
    const key = `${index}|${colors.map((color) => colored[color]).join(",")}|${cappedTotal}`;
    if (memo.has(key)) return false;
    memo.add(key);

    if (search(index + 1, colored, total)) return true;

    const source = sources[index];
    for (const color of source.colors) {
      if (!colors.includes(color)) continue;
      const next = { ...colored };
      next[color] = Math.min(
        requirement.colored[color] ?? 0,
        (next[color] ?? 0) + source.amount,
      );
      if (search(index + 1, next, total + source.amount)) return true;
    }
    return false;
  };

  return search(0, initial, poolTotal);
}

function enumerateSelectionChoices(
  options: Array<{ weight: number; canRepeat: boolean }>,
  minTotal: number,
  maxTotal: number,
  limit = 96,
): number[][] {
  const results: number[][] = [];
  const walk = (index: number, total: number, chosen: number[]) => {
    if (results.length >= limit) return;
    if (index >= options.length) {
      if (total >= minTotal && total <= maxTotal) results.push([...chosen]);
      return;
    }
    const option = options[index];
    const maxCount = option.canRepeat
      ? Math.floor((maxTotal - total) / Math.max(1, option.weight))
      : total + option.weight <= maxTotal
        ? 1
        : 0;
    for (let count = 0; count <= maxCount; count += 1) {
      for (let n = 0; n < count; n += 1) chosen.push(index);
      walk(index + 1, total + count * option.weight, chosen);
      chosen.splice(chosen.length - count, count);
    }
  };
  walk(0, 0, []);
  return results;
}

export function chooseDeterministicReorder(prompt: Prompt): PromptOutput["output"] | null {
  if (prompt.input.type !== "reorder") return null;
  if (prompt.input.items.length <= 1) {
    return {
      type: "reorderDecision",
      orderedIds: prompt.input.items.map((item) => item.id),
    };
  }

  const first = prompt.input.items[0];
  const firstSignature = JSON.stringify({
    cardId: first.card.id,
    oracle: first.oracle ?? null,
  });
  const equivalent = prompt.input.items.every(
    (item) =>
      JSON.stringify({
        cardId: item.card.id,
        oracle: item.oracle ?? null,
      }) === firstSignature,
  );
  if (!equivalent) return null;

  return {
    type: "reorderDecision",
    orderedIds: prompt.input.items.map((item) => item.id),
  };
}

interface ManaActionCandidate {
  actionId: string;
  cardId: string;
  colors: string[];
  amount: number;
}

export interface DeterministicManaPlan {
  output: { type: "act"; actionId: string };
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

    const cardId = typeof action.cardId === "string" ? action.cardId : null;
    if (!cardId) return [];

    if (produced.length === 1) {
      return [{
        actionId: action.id as string,
        cardId,
        colors: [produced[0].color as string],
        amount: produced[0].amount as number,
      }];
    }


    const flexible = cardId ? visibleSources.find((source) => source.id === cardId) : null;
    if (!flexible || flexible.colors.length === 0 || flexible.amount <= 0) return [];

    return [{
      actionId: action.id as string,
      cardId,
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
    const eligible = candidates.filter((item) => item.colors.includes(deficit.color));
    const sourceIds = [...new Set(eligible.map((item) => item.cardId))];
    // Producing a required color is mechanical only when exactly one permanent
    // can do it. Choosing between distinct sources can change future colors,
    // life payments, land abilities, or post-resolution mana and is strategic.
    if (sourceIds.length !== 1) return null;
    const chosen = eligible.find((item) => item.cardId === sourceIds[0]);
    if (!chosen) return null;
    return {
      output: { type: "act", actionId: chosen.actionId },
      preferredColor: chosen.colors.length > 1 ? deficit.color : null,
    };
  }

  const poolTotal = ["W", "U", "B", "R", "G", "C"].reduce(
    (sum, color) => sum + (pool[color] ?? 0),
    0,
  );
  if (poolTotal >= requirement.total) return null;

  // Generic mana is also source-sensitive. Only automate it when one distinct
  // permanent is available, even if that permanent exposes multiple color
  // actions. This deliberately trades a few AI calls for correct sequencing.
  const sourceIds = [...new Set(candidates.map((item) => item.cardId))];
  if (sourceIds.length !== 1) return null;
  const sourceCandidates = candidates.filter((item) => item.cardId === sourceIds[0]);
  const chosen = sourceCandidates.find((item) => item.colors.length === 1) ?? sourceCandidates[0];
  if (!chosen) return null;
  return {
    output: { type: "act", actionId: chosen.actionId },
    preferredColor: chosen.colors.length > 1 ? chosen.colors[0] ?? null : null,
  };

  return null;
}

export function chooseDeterministicManaStep(
  prompt: Prompt,
  gameView: ClientGameView,
  playerId: string | null,
): PromptOutput["output"] | null {
  return chooseDeterministicManaPlan(prompt, gameView, playerId)?.output ?? null;
}

export interface CachedManaPlanStep {
  output: { type: "act"; actionId: string };
  preferredColor: string | null;
  remainingActionIds: string[];
}

export function chooseCachedManaPlanStep(
  prompt: Prompt,
  actionIds: string[],
): CachedManaPlanStep | null {
  if (prompt.input.type !== "payManaCost" || actionIds.length === 0) return null;
  const nextActionId = actionIds[0];
  const action = prompt.input.actions.find((candidate) => candidate.id === nextActionId);
  if (!action) return null;

  const raw = action as unknown as {
    producedMana?: Array<{ color?: string; amount?: number }>;
  };
  const produced = raw.producedMana ?? [];
  const actionIdColor = nextActionId.match(/:([WUBRGC])$/)?.[1] ?? null;
  const preferredColor =
    produced.length === 1 && typeof produced[0]?.color === "string"
      ? produced[0].color
      : actionIdColor;

  return {
    output: { type: "act", actionId: nextActionId },
    preferredColor,
    remainingActionIds: actionIds.slice(1),
  };
}

export function shouldCompleteWorkbenchTransaction(args: {
  gameOver: boolean;
  promptAdvanced: boolean;
  currentPrompt: Prompt | null;
  stackSize: number;
  isWaitingForResponse: boolean;
}): boolean {
  return (
    args.gameOver ||
    (
      args.promptAdvanced &&
      args.currentPrompt?.input.type === "chooseAction" &&
      args.stackSize === 0 &&
      !args.isWaitingForResponse
    )
  );
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
    turnsTaken: number;
    currentPlayerTurnNumber: number | null;
    landsInHand: number;
    landDropsRemaining: number;
    readyAttackers: {
      count: number;
      knownPower: number;
      unknownPowerCount: number;
    };
    opponents: Array<{
      id: string;
      life: number;
      visibleUntappedCreatures: number;
      visibleUntappedPotentialBlockers: number;
    }>;
    combatAssignments: Array<{
      attackerId: string;
      attackerName: string;
      blockerId: string;
      blockerName: string;
    }>;
    unblockedAttackers: Array<{
      id: string;
      name: string;
      power: number | null;
    }>;
    commanderThreats: Array<{
      opponentId: string;
      commanderId: string;
      commanderName: string;
      currentPower: number | null;
      damageDealt: number;
      damageNeeded: number;
      lethalIfUnblockedNow: boolean;
    }>;
    ownCommanders: Array<{
      id: string;
      name: string;
      visibleZone: string | null;
    }>;
    fightOutcomes: Array<{
      sourceId: string;
      sourceName: string;
      sourcePower: number | null;
      sourceToughness: number | null;
      targetId: string;
      targetName: string;
      targetPower: number | null;
      targetToughness: number | null;
      damageToTarget: number | null;
      damageToSource: number | null;
      targetLethalByToughness: boolean | null;
      sourceLethalByToughness: boolean | null;
    }>;
  };
  resolvingAbilityText: string | null;
  sourceFacts: {
    id: string | null;
    name: string | null;
    zone: string | null;
    controllerId: string | null;
    ownerId: string | null;
    permanentBattlefieldAbilitiesActiveByDefault: boolean;
    explicitlyMentionsOtherZone: boolean;
  } | null;
  actionSourceFacts: Array<{
    actionId: string;
    actionType: string | null;
    cardId: string;
    name: string;
    zone: string | null;
    controllerId: string | null;
    ownerId: string | null;
    permanentBattlefieldAbilitiesActiveByDefault: boolean;
    explicitlyMentionsOtherZone: boolean;
  }>;
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
    affordableSelections: Array<{
      chosenIndices: number[];
      totalManaCost: string;
    }> | null;
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


function allVisibleCards(gameView: ClientGameView) {
  return [
    ...(gameView.battlefield ?? []),
    ...gameView.players.flatMap((player) => [
      ...(player.hand ?? []),
      ...(player.graveyard ?? []),
      ...(player.exile ?? []),
      ...(player.commandZone ?? []),
      ...(player.library ?? []),
    ]),
  ];
}

function numericStat(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function visibleCardZone(gameView: ClientGameView, cardId: string): string | null {
  if ((gameView.stack ?? []).some((item) => item.sourceId === cardId)) return "stack";
  const card = allVisibleCards(gameView).find((candidate) => candidate.id === cardId);
  if (card?.zoneId) return card.zoneId;
  if ((gameView.battlefield ?? []).some((candidate) => candidate.id === cardId)) return "battlefield";
  return null;
}

function explicitOtherZoneAbility(text: string | null | undefined): boolean {
  return /\b(command zone|graveyard|exile|exiled|hand|library)\b/i.test(text ?? "");
}

function permanentAbilitiesActiveByDefault(zone: string | null): boolean {
  return zone === "battlefield";
}

function actionDependencyText(prompt: Prompt): string {
  if (prompt.input.type !== "chooseAction") return "";
  return prompt.input.actions
    .map((action) => {
      const value = action as unknown as AnyRecord;
      return [value.label, value.description, value.cost]
        .filter((part): part is string => typeof part === "string")
        .join(" ");
    })
    .join(" ");
}

function actionCardHasFight(prompt: Prompt, gameView: ClientGameView): boolean {
  if (prompt.input.type !== "chooseAction") return false;
  const byId = new Map(allVisibleCards(gameView).map((card) => [card.id, card]));
  return prompt.input.actions.some((action) => {
    const raw = action as unknown as AnyRecord;
    const card = typeof raw.cardId === "string" ? byId.get(raw.cardId) : null;
    return !!card && /\bfight(?:s|ing)?\b/i.test(card.text ?? "");
  });
}

function materialCardState(card: AnyRecord): AnyRecord {
  const identity = record(card.identity);
  return {
    id: card.id,
    name: identity?.name ?? card.name,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    zone: card.zoneId ?? card.zone,
    tapped: card.tapped,
    attacking: card.isAttacking ?? card.attacking,
    attackTargetId: card.attackTargetId,
    summoningSick: card.summoningSick,
    power: card.power,
    toughness: card.toughness,
    damage: card.damage,
    counters: card.counters,
    attachmentIds: card.attachmentIds,
    attachedTo: card.attachedTo,
    transformed: card.isTransformed ?? card.transformed,
    faceDown: card.isFaceDown ?? card.faceDown,
  };
}

export function buildMaterialDecisionFingerprint(
  prompt: Prompt,
  gameView: ClientGameView,
): string {
  const modelPrompt = promptForWorkbenchModel(prompt);
  const decidingPlayerId =
    prompt.decidingPlayerId ?? gameView.priorityPlayerId ?? gameView.activePlayerId ?? null;
  const decidingPlayer = gameView.players.find((player) => player.id === decidingPlayerId);
  const byId = new Map(allVisibleCards(gameView).map((card) => [card.id, card]));
  const actionCardText =
    modelPrompt.input.type === "chooseAction"
      ? modelPrompt.input.actions
          .flatMap((action) => {
            const value = action as unknown as AnyRecord;
            const card =
              typeof value.cardId === "string" ? byId.get(value.cardId) : null;
            return card?.text ? [card.text] : [];
          })
          .join(" ")
      : "";
  const text = `${actionDependencyText(modelPrompt)} ${actionCardText}`;

  const strategicActions =
    modelPrompt.input.type === "chooseAction"
      ? modelPrompt.input.actions.map((action) => {
          const value = action as unknown as AnyRecord;
          const cardId = typeof value.cardId === "string" ? value.cardId : null;
          const card = cardId ? byId.get(cardId) : null;
          return {
            type: value.type,
            cardId,
            abilityIndex: value.abilityIndex,
            label: value.label,
            description: value.description,
            cost: value.cost,
            mode: value.mode,
            sourceState: card
              ? materialCardState(card as unknown as AnyRecord)
              : cardId
                ? { id: cardId, zone: visibleCardZone(gameView, cardId) }
                : null,
          };
        })
      : modelPrompt.input;

  const needsBattlefield =
    /\b(target|creature|permanent|destroy|exile|fight|damage|aura|attack|block|counter|tap|untap|land|island|swamp|forest|plains|mountain|mana)\b/i.test(text);
  const needsGraveyards =
    /\b(graveyard|flashback|escape|delve|reanimate|return|exile|copy)\b/i.test(text);
  const needsHands = /\b(hand|discard|draw)\b/i.test(text);
  const needsLife = /\b(life|damage|lose|gain)\b/i.test(text);

  return JSON.stringify({
    turn: gameView.turn,
    activePlayerId: gameView.activePlayerId,
    priorityPlayerId: gameView.priorityPlayerId,
    decidingPlayer: decidingPlayer
      ? {
          id: decidingPlayer.id,
          life: decidingPlayer.life,
          manaPool: decidingPlayer.manaPool,
          hand: needsHands ? (decidingPlayer.hand ?? []).map((card) => card.id) : undefined,
        }
      : null,
    opponentLife: needsLife
      ? gameView.players
          .filter((player) => player.id !== decidingPlayerId)
          .map((player) => ({ id: player.id, life: player.life }))
      : undefined,
    battlefield: needsBattlefield
      ? (gameView.battlefield ?? []).map((card) => materialCardState(card as unknown as AnyRecord))
      : undefined,
    graveyards: needsGraveyards
      ? gameView.players.map((player) => ({
          id: player.id,
          cards: (player.graveyard ?? []).map((card) => card.id),
        }))
      : undefined,
    stack: (gameView.stack ?? []).map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      controllerId: item.controllerId,
      ownerId: item.ownerId,
      name: item.identity.name,
      targets: item.targets,
    })),
    combatAssignments: needsBattlefield ? gameView.combatAssignments : undefined,
    actions: strategicActions,
  });
}

export function summarizeWorkbenchStateDelta(before: unknown, after: unknown): string[] {
  const previous = record(before);
  const next = record(after);
  if (!previous || !next) return [];

  const deltas: string[] = [];
  const previousPlayers = Array.isArray(previous.players) ? previous.players.map(record).filter(Boolean) as AnyRecord[] : [];
  const nextPlayers = Array.isArray(next.players) ? next.players.map(record).filter(Boolean) as AnyRecord[] : [];
  for (const player of nextPlayers) {
    const id = typeof player.id === "string" ? player.id : "";
    const prior = previousPlayers.find((candidate) => candidate.id === id);
    if (!prior) continue;
    for (const key of ["life", "handCount", "libraryCount"] as const) {
      if (prior[key] !== player[key]) deltas.push(`${id} ${key}: ${String(prior[key])} -> ${String(player[key])}`);
    }
    if (JSON.stringify(prior.commanderDamage) !== JSON.stringify(player.commanderDamage)) {
      deltas.push(`${id} commanderDamage: ${JSON.stringify(prior.commanderDamage ?? {})} -> ${JSON.stringify(player.commanderDamage ?? {})}`);
    }
  }

  const previousBattlefield = Array.isArray(previous.battlefield) ? previous.battlefield.map(record).filter(Boolean) as AnyRecord[] : [];
  const nextBattlefield = Array.isArray(next.battlefield) ? next.battlefield.map(record).filter(Boolean) as AnyRecord[] : [];
  const nameOf = (card: AnyRecord) => typeof card.name === "string" ? card.name : String(card.id ?? "card");
  for (const card of nextBattlefield) {
    const prior = previousBattlefield.find((candidate) => candidate.id === card.id);
    if (!prior) {
      deltas.push(`battlefield + ${nameOf(card)}`);
      continue;
    }
    if (prior.damage !== card.damage) deltas.push(`${nameOf(card)} damage: ${String(prior.damage ?? 0)} -> ${String(card.damage ?? 0)}`);
    if (prior.tapped !== card.tapped) deltas.push(`${nameOf(card)} tapped: ${String(prior.tapped)} -> ${String(card.tapped)}`);
    if (JSON.stringify(prior.counters) !== JSON.stringify(card.counters)) {
      deltas.push(`${nameOf(card)} counters: ${JSON.stringify(prior.counters ?? {})} -> ${JSON.stringify(card.counters ?? {})}`);
    }
  }
  for (const card of previousBattlefield) {
    if (!nextBattlefield.some((candidate) => candidate.id === card.id)) {
      deltas.push(`battlefield - ${nameOf(card)}`);
    }
  }

  const previousStack = Array.isArray(previous.stack) ? previous.stack.map(record).filter(Boolean) as AnyRecord[] : [];
  const nextStack = Array.isArray(next.stack) ? next.stack.map(record).filter(Boolean) as AnyRecord[] : [];
  if (JSON.stringify(previousStack.map((item) => item?.name)) !== JSON.stringify(nextStack.map((item) => item?.name))) {
    deltas.push(`stack: ${JSON.stringify(previousStack.map((item) => item?.name))} -> ${JSON.stringify(nextStack.map((item) => item?.name))}`);
  }

  return deltas.slice(0, 24);
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

    const baseManaCost =
      typeof sourceCard?.manaCost === "string" ? sourceCard.manaCost : null;
    const options = currentPrompt.input.options.map((option, index) => ({
      index,
      label: typeof option.label === "string" ? option.label : null,
      additionalCost: additionalCosts[index] ?? null,
    }));
    const availability = estimateManaAvailability(gameView, currentPrompt.decidingPlayerId);
    const combinations =
      baseManaCost && options.every((option) => option.additionalCost != null)
        ? enumerateSelectionChoices(
            currentPrompt.input.options,
            currentPrompt.input.minTotal,
            currentPrompt.input.maxTotal,
          )
        : [];
    const affordableSelections =
      combinations.length > 0
        ? combinations.flatMap((chosenIndices) => {
            const requirement = combineSimpleManaCosts([
              baseManaCost!,
              ...chosenIndices.map((index) => options[index].additionalCost!),
            ]);
            if (!requirement || !canPaySimpleManaRequirement(requirement, availability)) return [];
            return [{
              chosenIndices,
              totalManaCost: manaRequirementLabel(requirement),
            }];
          })
        : null;

    selectionCostHints = {
      sourceCard: typeof identity?.name === "string" ? identity.name : null,
      baseManaCost,
      options,
      affordableSelections,
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

  const decidingPlayerId =
    currentPrompt?.decidingPlayerId ??
    gameView.priorityPlayerId ??
    gameView.activePlayerId ??
    gameView.players[0]?.id;
  const decidingPlayer =
    gameView.players.find((player) => player.id === decidingPlayerId) ?? gameView.players[0];

  const turnStartMs =
    currentTurnEntries.length > 0
      ? Math.min(...currentTurnEntries.map((entry) => entry.createdAt))
      : 0;
  const castLogEntriesThisTurn = gameLog
    .filter((entry) => entry.timestampMs >= turnStartMs)
    .flatMap((entry) => {
      const match = entry.message.match(/^(?:Cast|Cascade cast):\s*(.+)$/i);
      return match?.[1] ? [{ entry, name: match[1] }] : [];
    });
  const hasPlayerAttributedCastLog = castLogEntriesThisTurn.some(
    ({ entry }) => !!entry.playerId,
  );
  const spellsActuallyCastThisTurn = hasPlayerAttributedCastLog
    ? castLogEntriesThisTurn
        .filter(({ entry }) => entry.playerId === decidingPlayer?.id)
        .map(({ name }) => name)
    : castActionsChosenThisTurn;

  const isActivePlayer = decidingPlayer?.id === gameView.activePlayerId;
  const playerTurnIds = new Set<number>();
  for (const entry of sameGame) {
    const state = record(entry.visibleGameState);
    if (
      decidingPlayer?.id &&
      state?.activePlayerId === decidingPlayer.id &&
      typeof state.turn === "number"
    ) {
      playerTurnIds.add(state.turn);
    }
  }
  if (isActivePlayer) playerTurnIds.add(gameView.turn);

  const readyAttackerCards = (gameView.battlefield ?? []).filter((card) => {
    if (card.controllerId !== decidingPlayer?.id) return false;
    if (!card.types.includes("Creature") || card.tapped) return false;
    const hasHaste = (card.keywords ?? []).some((keyword) => /^haste$/i.test(keyword));
    return !card.summoningSick || hasHaste;
  });
  const numericAttackerPowers = readyAttackerCards
    .map((card) => Number(card.power))
    .filter((power) => Number.isFinite(power));


  const battlefieldById = new Map((gameView.battlefield ?? []).map((card) => [card.id, card]));
  const combatAssignments = (gameView.combatAssignments ?? []).flatMap((assignment) => {
    const raw = assignment as unknown as AnyRecord;
    if (typeof raw.attackerId !== "string" || typeof raw.blockerId !== "string") return [];
    const attacker = battlefieldById.get(raw.attackerId);
    const blocker = battlefieldById.get(raw.blockerId);
    return [{
      attackerId: raw.attackerId,
      attackerName: attacker?.identity.name ?? raw.attackerId,
      blockerId: raw.blockerId,
      blockerName: blocker?.identity.name ?? raw.blockerId,
    }];
  });
  const blockedAttackerIds = new Set(combatAssignments.map((assignment) => assignment.attackerId));
  const unblockedAttackers = (gameView.battlefield ?? [])
    .filter((card) => card.controllerId === decidingPlayer?.id && card.isAttacking && !blockedAttackerIds.has(card.id))
    .map((card) => ({
      id: card.id,
      name: card.identity.name,
      power: numericStat(card.power),
    }));

  const commanderCastRecord = record(decidingPlayer?.commanderCasts) ?? {};
  const commanderIds = Object.keys(commanderCastRecord);
  const visibleById = new Map(allVisibleCards(gameView).map((card) => [card.id, card]));
  const commanderThreats = gameView.players
    .filter((player) => player.id !== decidingPlayer?.id)
    .flatMap((opponent) => {
      const damage = record(opponent.commanderDamage) ?? {};
      return commanderIds.map((commanderId) => {
        const card = visibleById.get(commanderId);
        const currentPower = card ? numericStat(card.power) : null;
        const damageDealt = typeof damage[commanderId] === "number" ? damage[commanderId] as number : 0;
        const damageNeeded = Math.max(0, 21 - damageDealt);
        return {
          opponentId: opponent.id,
          commanderId,
          commanderName: card?.identity.name ?? commanderId,
          currentPower,
          damageDealt,
          damageNeeded,
          lethalIfUnblockedNow: currentPower != null && currentPower >= damageNeeded,
        };
      });
    });

  const ownCommanders = commanderIds.map((commanderId) => {
    const card = visibleById.get(commanderId);
    return {
      id: commanderId,
      name: card?.identity.name ?? commanderId,
      visibleZone: card?.zoneId ?? null,
    };
  });

  const fightOutcomes: WorkbenchDecisionContext["strategicFacts"]["fightOutcomes"] = [];
  if (currentPrompt && actionCardHasFight(currentPrompt, gameView)) {
    const ownCreatures = (gameView.battlefield ?? []).filter(
      (card) => card.controllerId === decidingPlayer?.id && card.types.includes("Creature"),
    );
    const opposingCreatures = (gameView.battlefield ?? []).filter(
      (card) => card.controllerId !== decidingPlayer?.id && card.types.includes("Creature"),
    );
    for (const source of ownCreatures) {
      for (const target of opposingCreatures) {
        const sourcePower = numericStat(source.power);
        const sourceToughness = numericStat(source.toughness);
        const targetPower = numericStat(target.power);
        const targetToughness = numericStat(target.toughness);
        const targetRemaining = targetToughness == null ? null : targetToughness - (target.damage ?? 0);
        const sourceRemaining = sourceToughness == null ? null : sourceToughness - (source.damage ?? 0);
        fightOutcomes.push({
          sourceId: source.id,
          sourceName: source.identity.name,
          sourcePower,
          sourceToughness,
          targetId: target.id,
          targetName: target.identity.name,
          targetPower,
          targetToughness,
          damageToTarget: sourcePower,
          damageToSource: targetPower,
          targetLethalByToughness:
            sourcePower == null || targetRemaining == null ? null : sourcePower >= targetRemaining,
          sourceLethalByToughness:
            targetPower == null || sourceRemaining == null ? null : targetPower >= sourceRemaining,
        });
      }
    }
  }

  const promptRecord = currentPrompt ? record(currentPrompt) : null;
  const resolvingAbilityText =
    typeof promptRecord?.sourceAbilityText === "string" && promptRecord.sourceAbilityText.trim()
      ? promptRecord.sourceAbilityText.trim()
      : null;

  const sourceCardRecord = record(promptRecord?.sourceCard);
  const sourceIdentity = record(sourceCardRecord?.identity);
  const sourceCardId =
    typeof sourceCardRecord?.id === "string" ? sourceCardRecord.id : null;
  const sourceVisibleCard = sourceCardId ? visibleById.get(sourceCardId) : null;
  const sourceZone = sourceCardId ? visibleCardZone(gameView, sourceCardId) : null;
  const sourceText =
    typeof sourceCardRecord?.text === "string"
      ? sourceCardRecord.text
      : sourceVisibleCard?.text ?? null;
  const sourceFacts: WorkbenchDecisionContext["sourceFacts"] = sourceCardId
    ? {
        id: sourceCardId,
        name:
          typeof sourceIdentity?.name === "string"
            ? sourceIdentity.name
            : sourceVisibleCard?.identity.name ?? null,
        zone: sourceZone,
        controllerId:
          typeof sourceCardRecord?.controllerId === "string"
            ? sourceCardRecord.controllerId
            : sourceVisibleCard?.controllerId ?? null,
        ownerId:
          typeof sourceCardRecord?.ownerId === "string"
            ? sourceCardRecord.ownerId
            : sourceVisibleCard?.ownerId ?? null,
        permanentBattlefieldAbilitiesActiveByDefault:
          permanentAbilitiesActiveByDefault(sourceZone),
        explicitlyMentionsOtherZone: explicitOtherZoneAbility(sourceText),
      }
    : null;

  const actionSourceFacts: WorkbenchDecisionContext["actionSourceFacts"] =
    currentPrompt?.input.type === "chooseAction"
      ? currentPrompt.input.actions.flatMap((action) => {
          const value = action as unknown as AnyRecord;
          if (typeof value.id !== "string" || typeof value.cardId !== "string") return [];
          const card = visibleById.get(value.cardId);
          const zone = visibleCardZone(gameView, value.cardId);
          return [{
            actionId: value.id,
            actionType: typeof value.type === "string" ? value.type : null,
            cardId: value.cardId,
            name: card?.identity.name ?? value.cardId,
            zone,
            controllerId: card?.controllerId ?? null,
            ownerId: card?.ownerId ?? null,
            permanentBattlefieldAbilitiesActiveByDefault:
              permanentAbilitiesActiveByDefault(zone),
            explicitlyMentionsOtherZone: explicitOtherZoneAbility(card?.text),
          }];
        })
      : [];

  const strategicFacts: WorkbenchDecisionContext["strategicFacts"] = {
    isActivePlayer,
    turnsTaken: playerTurnIds.size,
    currentPlayerTurnNumber: isActivePlayer ? playerTurnIds.size : null,
    landsInHand:
      (decidingPlayer?.hand ?? []).filter((card) => card.types.includes("Land")).length,
    landDropsRemaining: Math.max(
      0,
      (decidingPlayer?.maxLandPlaysPerTurn ?? 0) - (decidingPlayer?.landsPlayedThisTurn ?? 0),
    ),
    readyAttackers: {
      count: readyAttackerCards.length,
      knownPower: numericAttackerPowers.reduce((sum, power) => sum + power, 0),
      unknownPowerCount: readyAttackerCards.length - numericAttackerPowers.length,
    },
    opponents: gameView.players
      .filter((player) => player.id !== decidingPlayer?.id)
      .map((player) => {
        const visibleUntappedCreatures = (gameView.battlefield ?? []).filter(
          (card) =>
            card.controllerId === player.id &&
            card.types.includes("Creature") &&
            !card.tapped,
        ).length;
        return {
          id: player.id,
          life: player.life,
          visibleUntappedCreatures,
          visibleUntappedPotentialBlockers: visibleUntappedCreatures,
        };
      }),
    combatAssignments,
    unblockedAttackers,
    commanderThreats,
    ownCommanders,
    fightOutcomes,
  };

  return {
    currentTurn: gameView.turn,
    currentStep: gameView.step,
    manaAvailability: estimateManaAvailability(gameView, currentPrompt?.decidingPlayerId),
    strategicFacts,
    resolvingAbilityText,
    sourceFacts,
    actionSourceFacts,
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
      "Use strategicFacts for basic counts and turn-state facts instead of recounting or inferring them from prose. Use currentPlayerTurnNumber instead of inferring your turn number from the global turn. Do not claim there are no blockers when visibleUntappedPotentialBlockers is nonzero.",
      "When currentTransaction is present, continue the action you already initiated. Tapped/sacrificed/payment state may be the result of costs you intentionally paid.",
      "Outside the same multi-step transaction, re-evaluate every currently legal strategic option from the present game state. Do not continue a prior plan merely because an earlier decision intended it.",
      "Use manaAvailability as a highlighted estimate of the mana currently available without sacrificing cards; flexible sources list every color they can make.",
      "If selectionCostHints is present, add the source card's baseManaCost to every selected additionalCost before judging affordability. When affordableSelections is non-null, choose only an exact chosenIndices combination listed there; Workbench already checked those combinations against visible mana.",
      "If a payment attempt just failed, do not repeat the identical transaction unless resources changed; choose a cheaper mode or a different action.",
      "Workbench normally handles mechanical mana production during payManaCost. Do not float mana during ordinary priority without a concrete reason.",
      "Use spellsActuallyCastThisTurn as the authoritative spell-count continuity for this turn. Do not call a later spell the second spell if two spells are already listed.",
      "When resolvingAbilityText is present, it is the authoritative ability currently resolving. Do not substitute a different ability printed on the same card.",
      "Use sourceFacts and actionSourceFacts as authoritative ownership/control/zone facts. Never infer a card's owner from its controller.",
      "When rules text says CARDNAME's controller or 'this permanent's controller', apply that effect to the matching sourceFacts/actionSourceFacts.controllerId exactly, even when ownerId is a different player.",
      "For permanent cards, printed static and triggered battlefield abilities are active by default only while the permanent is on the battlefield. A permanent in hand, command zone, graveyard, exile, or on the stack does not get its normal battlefield abilities unless its exact text explicitly says that ability functions from that zone.",
      "Casting a permanent does not let that permanent's battlefield trigger see the event of itself being cast. For example, a permanent entering as the second spell cannot trigger a 'whenever you cast your second spell' ability printed on itself unless it was already on the battlefield before that spell was cast.",
      "Use fightOutcomes for baseline fight damage arithmetic. Do not claim a creature is removed when targetLethalByToughness is false unless a visible keyword or effect changes that result.",
      "Use combatAssignments and unblockedAttackers instead of inferring blocks from which creatures are untapped.",
      "Use commanderThreats for commander-damage arithmetic and actively check for deterministic lethal before choosing slower value lines.",
      "ownCommanders identifies the commander's currently visible zone. In a normal singleton Commander game, if a named commander is already visibly outside the library, do not assume a Partner/search effect can find another copy of that commander.",
      "Never treat hidden-library or other unresolved random outcomes as known. Describe future trigger results conditionally until the engine reveals them.",
      "On your turn, prefer to cast proactive spells in a main phase after the draw step and available land drop unless acting earlier has a concrete tactical benefit. State that benefit when deviating.",
    ],
  };
}
