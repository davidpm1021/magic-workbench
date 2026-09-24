import type { WorkbenchAuditEntry } from "@/stores/useWorkbenchStore";

export interface WorkbenchTelemetryCard {
  id: string;
  name: string;
  types: string[];
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
  turn: number;
  snapshots: number;
  openingHandSize: number;
  lowestLife: number | null;
  endingLife: number | null;
  maxLandsOnBattlefield: number;
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
}

export interface WorkbenchDeckTestSummary {
  games: number;
  wins: number;
  winRate: number;
  averageGameTurn: number;
  averageFirstNonlandPermanentTurn: number | null;
  noNonlandPermanentByTurn4Rate: number;
  averageMaxLandsOnBattlefield: number;
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
  return Object.values(record).reduce((sum, item) => sum + sumNumbers(item), 0);
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
  };
}

function readCards(value: unknown): WorkbenchTelemetryCard[] {
  return asArray(value).map(readCard).filter((card): card is WorkbenchTelemetryCard => card !== null);
}

export function captureWorkbenchTelemetrySnapshot(args: {
  compactGameView: unknown;
  playerId: string | null;
  deckName?: string | null;
  capturedAt?: number;
}): WorkbenchTelemetrySnapshot | null {
  const view = asRecord(args.compactGameView);
  if (!view) return null;
  const players = asArray(view.players).map(asRecord).filter((player): player is Record<string, unknown> => player !== null);
  const selected =
    players.find((player) => asString(player.id) === args.playerId) ??
    players[0] ??
    null;
  if (!selected) return null;

  const playerId = asString(selected.id);
  const battlefield = readCards(view.battlefield).filter((card) => {
    const source = asArray(view.battlefield)
      .map(asRecord)
      .find((candidate) => candidate && asString(candidate.id) === card.id);
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
  const snapshots = args.snapshots.filter((snapshot) => snapshot.gameId === args.gameId);
  const first = snapshots[0] ?? null;
  const last = snapshots.at(-1) ?? null;

  const handSeen = new Map<string, { name: string; firstTurn: number; lastTurn: number }>();
  const openingHandIds = new Set(first?.hand.map((card) => card.id) ?? []);
  const uniqueHandIds = new Set<string>();
  const uniqueSeenIds = new Set<string>();
  const stackIds = new Set<string>();
  const cardsCast: Record<string, number> = {};
  let firstNonlandPermanentTurn: number | null = null;
  let firstCommanderCastTurn: number | null = null;
  let maxLandsOnBattlefield = 0;
  let commanderCasts = 0;
  let lowestLife: number | null = null;

  for (const snapshot of snapshots) {
    lowestLife = lowestLife == null ? snapshot.player.life : Math.min(lowestLife, snapshot.player.life);
    commanderCasts = Math.max(commanderCasts, snapshot.player.commanderCasts);
    if (snapshot.player.commanderCasts > 0 && firstCommanderCastTurn == null) {
      firstCommanderCastTurn = snapshot.turn;
    }

    const landCount = snapshot.battlefield.filter((card) => card.types.includes("Land")).length;
    maxLandsOnBattlefield = Math.max(maxLandsOnBattlefield, landCount);

    if (
      firstNonlandPermanentTurn == null &&
      snapshot.battlefield.some((card) => !card.types.includes("Land"))
    ) {
      firstNonlandPermanentTurn = snapshot.turn;
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
        firstTurn: existing?.firstTurn ?? snapshot.turn,
        lastTurn: Math.max(existing?.lastTurn ?? snapshot.turn, snapshot.turn),
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

  const mulliganPrompts = args.auditEntries.filter((entry) =>
    entry.promptType.toLowerCase().includes("mulligan"),
  ).length;
  const paidAiCalls = args.auditEntries.filter((entry) => entry.source === "ai").length;
  const errors = args.auditEntries.filter((entry) => entry.status === "error").length;
  const estimatedCostUsd = args.auditEntries.reduce(
    (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
    0,
  );

  return {
    schemaVersion: 1,
    gameId: args.gameId,
    deckName: first?.deckName ?? last?.deckName ?? null,
    playerId: first?.player.id ?? last?.player.id ?? null,
    completedAt: Date.now(),
    winnerId: args.winnerId,
    won: args.winnerId != null && args.winnerId === (first?.player.id ?? last?.player.id),
    turn: args.turn,
    snapshots: snapshots.length,
    openingHandSize: first?.hand.length ?? 0,
    lowestLife,
    endingLife: last?.player.life ?? null,
    maxLandsOnBattlefield,
    firstNonlandPermanentTurn,
    firstCommanderCastTurn,
    commanderCasts,
    uniqueCardsSeen: uniqueSeenIds.size,
    cardsDrawnApprox: Math.max(0, [...uniqueHandIds].filter((id) => !openingHandIds.has(id)).length),
    castEvents: stackIds.size,
    cardsCast,
    stuckCards: [...stuckByName.entries()]
      .map(([name, maxObservedTurnSpan]) => ({ name, maxObservedTurnSpan }))
      .sort((a, b) => b.maxObservedTurnSpan - a.maxObservedTurnSpan || a.name.localeCompare(b.name)),
    mulliganPrompts,
    paidAiCalls,
    errors,
    estimatedCostUsd,
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

  return {
    games: reports.length,
    wins: reports.filter((report) => report.won).length,
    winRate:
      reports.length === 0 ? 0 : reports.filter((report) => report.won).length / reports.length,
    averageGameTurn: average(reports.map((report) => report.turn)),
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
}): void {
  const summary = summarizeWorkbenchDeckTest(args.reports);
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    targetGames: args.targetGames,
    startedAt: args.startedAt ? new Date(args.startedAt).toISOString() : null,
    summary,
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
