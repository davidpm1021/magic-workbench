import type { WorkbenchAuditEntry } from "@/stores/useWorkbenchStore";

export interface WorkbenchTelemetryCard {
  id: string;
  name: string;
  types: string[];
  manaCost?: string;
  text?: string;
  keywords?: string[];
}

export interface WorkbenchTelemetrySnapshot {
  gameId: string;
  capturedAt: number;
  deckName: string | null;
  turn: number;
  step: string;
  activePlayerId: string | null;
  gameOver: boolean;
  winnerId: string | null;
  player: {
    id: string;
    life: number;
    handCount: number;
    libraryCount: number;
    landsPlayedThisTurn: number;
    maxLandPlaysPerTurn: number;
    commanderCasts: number;
    manaPoolTotal: number;
  };
  hand: WorkbenchTelemetryCard[];
  battlefield: WorkbenchTelemetryCard[];
  graveyard: WorkbenchTelemetryCard[];
  exile: WorkbenchTelemetryCard[];
  commandZone: WorkbenchTelemetryCard[];
  stack: Array<{ id: string; name: string }>;
}

export interface WorkbenchStuckCard {
  name: string;
  maxObservedTurnSpan: number;
}

export interface WorkbenchGameTelemetry {
  schemaVersion: 1;
  gameId: string;
  deckName: string | null;
  playerId: string | null;
  completedAt: number;
  winnerId: string | null;
  won: boolean;
  engineTurn: number;
  playerTurns: number;
  snapshots: number;
  openingHandSize: number;
  openingLands: number;
  lowestLife: number | null;
  endingLife: number | null;
  maxLandsOnBattlefield: number;
  landDropsMade: number;
  missedLandDropTurns: number[];
  landDropRate: number;
  firstNonlandPermanentTurn: number | null;
  firstCommanderCastTurn: number | null;
  commanderCasts: number;
  uniqueCardsSeen: number;
  cardsDrawnApprox: number;
  castEvents: number;
  cardsCast: Record<string, number>;
  stuckCards: WorkbenchStuckCard[];
  mulliganPrompts: number;
  paidAiCalls: number;
  errors: number;
  estimatedCostUsd: number;
  commanderName?: string | null;
  commanderColors?: string[];
  commanderColorsAvailableByTurn5?: string[];
  missingCommanderColorsByTurn5?: string[];
  openingManaColors?: string[];
  keptOpeningHand?: boolean | null;
  manualRecoveries?: number;
  pilotRuleAssumptionRisks?: Array<{
    promptId: number;
    promptType: string;
    commanderName: string;
    keyword: string;
    reason: string;
  }>;
}

export interface WorkbenchDeckTestSummary {
  games: number;
  wins: number;
  winRate: number;
  averagePlayerTurns: number;
  averageOpeningLands: number;
  averageFirstNonlandPermanentTurn: number | null;
  noNonlandPermanentByTurn4Rate: number;
  averageMaxLandsOnBattlefield: number;
  landDropRate: number;
  averageCardsDrawnApprox: number;
  averagePaidAiCalls: number;
  totalEstimatedCostUsd: number;
  stuckCardGames: Record<string, number>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sumNumbers(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumNumbers(item), 0);
  const record = asRecord(value);
  if (!record) return 0;
  return Object.values(record).reduce<number>((sum, item) => sum + sumNumbers(item), 0);
}

function readCard(value: unknown): WorkbenchTelemetryCard | null {
  const card = asRecord(value);
  if (!card) return null;
  const id = asString(card.id);
  const name = asString(card.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    types: asArray(card.types).filter((item): item is string => typeof item === "string"),
    manaCost: asString(card.manaCost) || undefined,
    text: asString(card.text) || undefined,
    keywords: asArray(card.keywords).filter(
      (item): item is string => typeof item === "string",
    ),
  };
}

function readCards(value: unknown): WorkbenchTelemetryCard[] {
  return asArray(value)
    .map(readCard)
    .filter((card): card is WorkbenchTelemetryCard => card !== null);
}

const MANA_COLORS = ["W", "U", "B", "R", "G"] as const;

function manaColorsFromCost(cost: string | undefined): string[] {
  if (!cost) return [];
  return MANA_COLORS.filter((color) => cost.includes(color));
}

function manaColorsFromText(text: string | undefined): string[] {
  if (!text) return [];
  if (/add (?:one )?mana of any color/i.test(text)) return [...MANA_COLORS];
  const colors = new Set<string>();
  for (const line of text.split(/[.\n]/)) {
    if (!/\badd\b/i.test(line)) continue;
    for (const color of MANA_COLORS) {
      if (line.includes(`{${color}}`)) colors.add(color);
    }
  }
  return [...colors];
}

function manaColorsFromCards(cards: WorkbenchTelemetryCard[]): string[] {
  const colors = new Set<string>();
  for (const card of cards) {
    for (const color of manaColorsFromText(card.text)) colors.add(color);
  }
  return [...colors];
}

function playerFromAuditView(entry: WorkbenchAuditEntry): Record<string, unknown> | null {
  const view = asRecord(entry.visibleGameState);
  const promptSnapshot = asRecord(entry.promptSnapshot);
  const decidingPlayerId = asString(promptSnapshot?.decidingPlayerId);
  const players = asArray(view?.players)
    .map(asRecord)
    .filter((player): player is Record<string, unknown> => player !== null);
  return players.find((player) => asString(player.id) === decidingPlayerId) ?? null;
}

function findPilotRuleAssumptionRisks(
  entries: WorkbenchAuditEntry[],
): NonNullable<WorkbenchGameTelemetry["pilotRuleAssumptionRisks"]> {
  const risks: NonNullable<WorkbenchGameTelemetry["pilotRuleAssumptionRisks"]> = [];
  for (const entry of entries) {
    if (
      entry.source !== "ai" ||
      !entry.reason ||
      (entry.promptType !== "chooseAttackers" && entry.promptType !== "chooseBlockers")
    ) {
      continue;
    }
    const player = playerFromAuditView(entry);
    const commandZone = readCards(player?.commandZone);
    const battlefield = readCards(asRecord(entry.visibleGameState)?.battlefield);
    for (const commander of commandZone) {
      if (battlefield.some((card) => card.id === commander.id)) continue;
      const keyword = (commander.keywords ?? []).find((candidate) =>
        entry.reason!.toLowerCase().includes(candidate.toLowerCase()),
      );
      if (!keyword) continue;
      risks.push({
        promptId: entry.promptId,
        promptType: entry.promptType,
        commanderName: commander.name,
        keyword,
        reason: entry.reason,
      });
    }
  }
  return risks;
}

export function captureWorkbenchTelemetrySnapshot(args: {
  compactGameView: unknown;
  playerId: string | null;
  deckName?: string | null;
  capturedAt?: number;
}): WorkbenchTelemetrySnapshot | null {
  const view = asRecord(args.compactGameView);
  if (!view) return null;
  const players = asArray(view.players)
    .map(asRecord)
    .filter((player): player is Record<string, unknown> => player !== null);
  const selected =
    players.find((player) => asString(player.id) === args.playerId) ??
    players[0] ??
    null;
  if (!selected) return null;

  const playerId = asString(selected.id);
  const battlefieldValues = asArray(view.battlefield).map(asRecord);
  const battlefield = readCards(view.battlefield).filter((card) => {
    const source = battlefieldValues.find(
      (candidate) => candidate && asString(candidate.id) === card.id,
    );
    return !source || asString(source.controllerId) === playerId;
  });
  const stack = asArray(view.stack)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null)
    .filter((item) => asString(item.controllerId) === playerId)
    .map((item) => ({ id: asString(item.id), name: asString(item.name) }))
    .filter((item) => item.id && item.name);

  return {
    gameId: asString(view.gameId),
    capturedAt: args.capturedAt ?? Date.now(),
    deckName: args.deckName ?? null,
    turn: asNumber(view.turn),
    step: asString(view.step),
    activePlayerId: asString(view.activePlayerId) || null,
    gameOver: Boolean(view.gameOver),
    winnerId: asString(view.winnerId) || null,
    player: {
      id: playerId,
      life: asNumber(selected.life),
      handCount: asNumber(selected.handCount, readCards(selected.hand).length),
      libraryCount: asNumber(selected.libraryCount),
      landsPlayedThisTurn: asNumber(selected.landsPlayedThisTurn),
      maxLandPlaysPerTurn: asNumber(selected.maxLandPlaysPerTurn, 1),
      commanderCasts: sumNumbers(selected.commanderCasts),
      manaPoolTotal: sumNumbers(selected.manaPool),
    },
    hand: readCards(selected.hand),
    battlefield,
    graveyard: readCards(selected.graveyard),
    exile: readCards(selected.exile),
    commandZone: readCards(selected.commandZone),
    stack,
  };
}

export function telemetrySnapshotFingerprint(snapshot: WorkbenchTelemetrySnapshot): string {
  return JSON.stringify({
    gameId: snapshot.gameId,
    turn: snapshot.turn,
    step: snapshot.step,
    activePlayerId: snapshot.activePlayerId,
    gameOver: snapshot.gameOver,
    winnerId: snapshot.winnerId,
    life: snapshot.player.life,
    hand: snapshot.hand.map((card) => card.id),
    battlefield: snapshot.battlefield.map((card) => card.id),
    graveyard: snapshot.graveyard.map((card) => card.id),
    exile: snapshot.exile.map((card) => card.id),
    commandZone: snapshot.commandZone.map((card) => card.id),
    stack: snapshot.stack.map((item) => item.id),
    commanderCasts: snapshot.player.commanderCasts,
    landsPlayedThisTurn: snapshot.player.landsPlayedThisTurn,
    maxLandPlaysPerTurn: snapshot.player.maxLandPlaysPerTurn,
    manaPoolTotal: snapshot.player.manaPoolTotal,
  });
}

export function buildWorkbenchGameTelemetry(args: {
  gameId: string;
  winnerId: string | null;
  turn: number;
  snapshots: WorkbenchTelemetrySnapshot[];
  auditEntries: WorkbenchAuditEntry[];
}): WorkbenchGameTelemetry {
  const snapshots = args.snapshots
    .filter((snapshot) => snapshot.gameId === args.gameId)
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const first = snapshots[0] ?? null;
  const last = snapshots.at(-1) ?? null;
  const opening = snapshots.find((snapshot) => snapshot.hand.length > 0) ?? first;
  const playerId = first?.player.id ?? last?.player.id ?? null;

  const handSeen = new Map<string, { name: string; firstTurn: number; lastTurn: number }>();
  const openingHandIds = new Set(opening?.hand.map((card) => card.id) ?? []);
  const uniqueHandIds = new Set<string>();
  const uniqueSeenIds = new Set<string>();
  const stackIds = new Set<string>();
  const cardsCast: Record<string, number> = {};
  const landDropsByTurn = new Map<number, { played: number; allowed: number }>();
  let playerTurns = 0;
  let playerWasActive = false;
  let firstNonlandPermanentTurn: number | null = null;
  let firstCommanderCastTurn: number | null = null;
  let maxLandsOnBattlefield = 0;
  let commanderCasts = 0;
  let lowestLife: number | null = null;
  const commander = opening?.commandZone[0] ?? first?.commandZone[0] ?? last?.commandZone[0] ?? null;
  const commanderColors = manaColorsFromCost(commander?.manaCost);
  const commanderColorsAvailableByTurn5 = new Set<string>();

  for (const snapshot of snapshots) {
    const playerIsActive = snapshot.activePlayerId === playerId;
    if (playerIsActive && !playerWasActive) playerTurns += 1;
    playerWasActive = playerIsActive;

    lowestLife =
      lowestLife == null ? snapshot.player.life : Math.min(lowestLife, snapshot.player.life);
    commanderCasts = Math.max(commanderCasts, snapshot.player.commanderCasts);
    if (snapshot.player.commanderCasts > 0 && firstCommanderCastTurn == null) {
      firstCommanderCastTurn = playerTurns;
    }

    const landCount = snapshot.battlefield.filter((card) => card.types.includes("Land")).length;
    maxLandsOnBattlefield = Math.max(maxLandsOnBattlefield, landCount);

    if (
      firstNonlandPermanentTurn == null &&
      snapshot.battlefield.some((card) => !card.types.includes("Land"))
    ) {
      firstNonlandPermanentTurn = playerTurns;
    }

    if (playerTurns <= 5) {
      for (const color of manaColorsFromCards(snapshot.battlefield)) {
        commanderColorsAvailableByTurn5.add(color);
      }
    }

    if (playerIsActive && playerTurns > 0) {
      const previous = landDropsByTurn.get(playerTurns) ?? { played: 0, allowed: 0 };
      landDropsByTurn.set(playerTurns, {
        played: Math.max(previous.played, snapshot.player.landsPlayedThisTurn),
        allowed: Math.max(previous.allowed, snapshot.player.maxLandPlaysPerTurn),
      });
    }

    for (const card of [
      ...snapshot.hand,
      ...snapshot.battlefield,
      ...snapshot.graveyard,
      ...snapshot.exile,
    ]) {
      uniqueSeenIds.add(card.id);
    }

    for (const card of snapshot.hand) {
      uniqueHandIds.add(card.id);
      const existing = handSeen.get(card.id);
      handSeen.set(card.id, {
        name: card.name,
        firstTurn: existing?.firstTurn ?? playerTurns,
        lastTurn: Math.max(existing?.lastTurn ?? playerTurns, playerTurns),
      });
    }

    for (const item of snapshot.stack) {
      if (stackIds.has(item.id)) continue;
      stackIds.add(item.id);
      cardsCast[item.name] = (cardsCast[item.name] ?? 0) + 1;
    }
  }

  const stuckByName = new Map<string, number>();
  for (const value of handSeen.values()) {
    const span = value.lastTurn - value.firstTurn;
    if (span < 3) continue;
    stuckByName.set(value.name, Math.max(stuckByName.get(value.name) ?? 0, span));
  }

  const eligibleLandDropTurns = [...landDropsByTurn.entries()]
    .filter(([, value]) => value.allowed > 0)
    .sort(([left], [right]) => left - right);
  const missedLandDropTurns = eligibleLandDropTurns
    .filter(([, value]) => value.played === 0)
    .map(([turn]) => turn);
  const landDropsMade = eligibleLandDropTurns.filter(([, value]) => value.played > 0).length;
  const landDropRate =
    eligibleLandDropTurns.length === 0 ? 0 : landDropsMade / eligibleLandDropTurns.length;

  const mulliganEntries = args.auditEntries.filter((entry) =>
    entry.promptType.toLowerCase().includes("mulligan"),
  );
  const mulliganPrompts = mulliganEntries.length;
  const openingMulligan = mulliganEntries.find((entry) => entry.promptType === "mulligan");
  const openingMulliganOutput = asRecord(openingMulligan?.output);
  const keptOpeningHand =
    typeof openingMulliganOutput?.keep === "boolean" ? openingMulliganOutput.keep : null;
  const paidAiCalls = args.auditEntries.filter((entry) => entry.source === "ai").length;
  const errors = args.auditEntries.filter((entry) => entry.status === "error").length;
  const estimatedCostUsd = args.auditEntries.reduce(
    (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
    0,
  );
  const availableCommanderColors = [...commanderColorsAvailableByTurn5];
  const missingCommanderColorsByTurn5 = commanderColors.filter(
    (color) => !commanderColorsAvailableByTurn5.has(color),
  );
  const openingManaColors = manaColorsFromCards(opening?.hand ?? []);
  const manualRecoveries = args.auditEntries.filter(
    (entry) => entry.source === "human" || entry.status === "manual",
  ).length;
  const pilotRuleAssumptionRisks = findPilotRuleAssumptionRisks(args.auditEntries);

  return {
    schemaVersion: 1,
    gameId: args.gameId,
    deckName: first?.deckName ?? last?.deckName ?? null,
    playerId,
    completedAt: Date.now(),
    winnerId: args.winnerId,
    won: args.winnerId != null && args.winnerId === playerId,
    engineTurn: args.turn,
    playerTurns,
    snapshots: snapshots.length,
    openingHandSize: opening?.hand.length ?? 0,
    openingLands: opening?.hand.filter((card) => card.types.includes("Land")).length ?? 0,
    lowestLife,
    endingLife: last?.player.life ?? null,
    maxLandsOnBattlefield,
    landDropsMade,
    missedLandDropTurns,
    landDropRate,
    firstNonlandPermanentTurn,
    firstCommanderCastTurn,
    commanderCasts,
    uniqueCardsSeen: uniqueSeenIds.size,
    cardsDrawnApprox: Math.max(
      0,
      [...uniqueHandIds].filter((id) => !openingHandIds.has(id)).length,
    ),
    castEvents: stackIds.size,
    cardsCast,
    stuckCards: [...stuckByName.entries()]
      .map(([name, maxObservedTurnSpan]) => ({ name, maxObservedTurnSpan }))
      .sort(
        (left, right) =>
          right.maxObservedTurnSpan - left.maxObservedTurnSpan ||
          left.name.localeCompare(right.name),
      ),
    mulliganPrompts,
    paidAiCalls,
    errors,
    estimatedCostUsd,
    commanderName: commander?.name ?? null,
    commanderColors,
    commanderColorsAvailableByTurn5: availableCommanderColors,
    missingCommanderColorsByTurn5,
    openingManaColors,
    keptOpeningHand,
    manualRecoveries,
    pilotRuleAssumptionRisks,
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeWorkbenchDeckTest(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDeckTestSummary {
  const stuckCardGames: Record<string, number> = {};
  for (const report of reports) {
    for (const card of report.stuckCards) {
      stuckCardGames[card.name] = (stuckCardGames[card.name] ?? 0) + 1;
    }
  }
  const firstPermanentTurns = reports
    .map((report) => report.firstNonlandPermanentTurn)
    .filter((turn): turn is number => turn != null);
  const eligibleLandDropTurns = reports.reduce(
    (sum, report) => sum + report.landDropsMade + report.missedLandDropTurns.length,
    0,
  );
  const landDropsMade = reports.reduce((sum, report) => sum + report.landDropsMade, 0);

  return {
    games: reports.length,
    wins: reports.filter((report) => report.won).length,
    winRate:
      reports.length === 0 ? 0 : reports.filter((report) => report.won).length / reports.length,
    averagePlayerTurns: average(reports.map((report) => report.playerTurns)),
    averageOpeningLands: average(reports.map((report) => report.openingLands)),
    averageFirstNonlandPermanentTurn:
      firstPermanentTurns.length === 0 ? null : average(firstPermanentTurns),
    noNonlandPermanentByTurn4Rate:
      reports.length === 0
        ? 0
        : reports.filter(
            (report) =>
              report.firstNonlandPermanentTurn == null || report.firstNonlandPermanentTurn > 4,
          ).length / reports.length,
    averageMaxLandsOnBattlefield: average(
      reports.map((report) => report.maxLandsOnBattlefield),
    ),
    landDropRate: eligibleLandDropTurns === 0 ? 0 : landDropsMade / eligibleLandDropTurns,
    averageCardsDrawnApprox: average(reports.map((report) => report.cardsDrawnApprox)),
    averagePaidAiCalls: average(reports.map((report) => report.paidAiCalls)),
    totalEstimatedCostUsd: reports.reduce(
      (sum, report) => sum + report.estimatedCostUsd,
      0,
    ),
    stuckCardGames,
  };
}

export function downloadWorkbenchDeckTest(args: {
  reports: WorkbenchGameTelemetry[];
  targetGames: number;
  startedAt: number | null;
  diagnostics?: unknown;
}): void {
  const summary = summarizeWorkbenchDeckTest(args.reports);
  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    targetGames: args.targetGames,
    startedAt: args.startedAt ? new Date(args.startedAt).toISOString() : null,
    summary,
    diagnostics: args.diagnostics ?? null,
    games: args.reports,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `magic-workbench-deck-test-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
