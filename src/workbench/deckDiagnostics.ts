import type {
  WorkbenchDeckTestSummary,
  WorkbenchGameTelemetry,
} from "./deckTelemetry";

export type WorkbenchDiagnosticCategory = "deck" | "pilot";
export type WorkbenchDiagnosticConfidence = "low" | "medium" | "high";

export interface WorkbenchDiagnosticFinding {
  id: string;
  category: WorkbenchDiagnosticCategory;
  title: string;
  confidence: WorkbenchDiagnosticConfidence;
  gamesAffected: number;
  gamesEvaluated: number;
  evidence: string[];
}

export interface WorkbenchMatchupDiagnostic {
  archetype: string;
  games: number;
  wins: number;
  winRate: number;
  confidence: WorkbenchDiagnosticConfidence;
}

export interface WorkbenchDeckDiagnostics {
  schemaVersion: 2;
  generatedAt: string;
  sample: {
    games: number;
    targetForBaseline: number;
    targetForHighConfidence: number;
    status: "insufficient" | "developing" | "useful";
    message: string;
  };
  benchmark: {
    multiplayer: boolean;
    equalShareBaseline: number | null;
    winRate: number;
    deltaFromBaseline: number | null;
    matchups: WorkbenchMatchupDiagnostic[];
  };
  deckFindings: WorkbenchDiagnosticFinding[];
  pilotFindings: WorkbenchDiagnosticFinding[];
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function confidenceForSample(
  games: number,
  affected: number,
): WorkbenchDiagnosticConfidence {
  if (games >= 8 && affected / games >= 0.5) return "high";
  if (games >= 3 && affected >= 2) return "medium";
  return "low";
}

function pushFinding(
  target: WorkbenchDiagnosticFinding[],
  finding: WorkbenchDiagnosticFinding,
): void {
  if (finding.gamesAffected <= 0 || finding.gamesEvaluated <= 0) return;
  target.push(finding);
}

function commanderColorFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const eligible = reports.filter((report) => (report.commanderColors?.length ?? 0) > 0);
  const affected = eligible.filter(
    (report) => (report.missingCommanderColorsByTurn5?.length ?? 0) > 0,
  );
  if (affected.length === 0) return null;

  const missingCounts = new Map<string, number>();
  for (const report of affected) {
    for (const color of report.missingCommanderColorsByTurn5 ?? []) {
      missingCounts.set(color, (missingCounts.get(color) ?? 0) + 1);
    }
  }
  const missing = [...missingCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([color, games]) => `${color} in ${games}/${eligible.length}`)
    .join(", ");

  return {
    id: "commander-color-access",
    category: "deck",
    title: "Commander color access",
    confidence: confidenceForSample(eligible.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: eligible.length,
    evidence: [
      `${affected.length}/${eligible.length} games were still missing at least one commander color by own turn 5 (${percent(affected.length / eligible.length)}).`,
      `Missing-color frequency: ${missing}.`,
    ],
  };
}

function commanderDeploymentFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const eligible = reports.filter((report) => report.commanderName);
  const affected = eligible.filter(
    (report) => report.commanderCasts === 0 || (report.firstCommanderCastTurn ?? Infinity) > 5,
  );
  if (affected.length === 0) return null;

  const neverCast = affected.filter((report) => report.commanderCasts === 0).length;
  return {
    id: "commander-deployment",
    category: "deck",
    title: "Commander deployment",
    confidence: confidenceForSample(eligible.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: eligible.length,
    evidence: [
      `${affected.length}/${eligible.length} games did not cast the commander by own turn 5 (${percent(affected.length / eligible.length)}).`,
      `${neverCast}/${eligible.length} games ended without a commander cast.`,
    ],
  };
}

function earlyBoardFinding(
  reports: WorkbenchGameTelemetry[],
  summary: WorkbenchDeckTestSummary,
): WorkbenchDiagnosticFinding | null {
  const affected = reports.filter(
    (report) =>
      report.firstNonlandPermanentTurn == null || report.firstNonlandPermanentTurn > 4,
  );
  if (affected.length === 0) return null;
  return {
    id: "early-board-development",
    category: "deck",
    title: "Early board development",
    confidence: confidenceForSample(reports.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: reports.length,
    evidence: [
      `${affected.length}/${reports.length} games had no nonland permanent by own turn 4 (${percent(summary.noNonlandPermanentByTurn4Rate)}).`,
      summary.averageFirstNonlandPermanentTurn == null
        ? "No nonland permanent was observed in the evaluated games."
        : `Average first nonland permanent: own turn ${summary.averageFirstNonlandPermanentTurn.toFixed(1)}.`,
    ],
  };
}

function landDropFinding(
  reports: WorkbenchGameTelemetry[],
  summary: WorkbenchDeckTestSummary,
): WorkbenchDiagnosticFinding | null {
  const affected = reports.filter((report) => report.missedLandDropTurns.length > 0);
  if (affected.length === 0 || summary.landDropRate >= 0.9) return null;
  const missed = reports.reduce(
    (sum, report) => sum + report.missedLandDropTurns.length,
    0,
  );
  return {
    id: "land-drop-reliability",
    category: "deck",
    title: "Land-drop reliability",
    confidence: confidenceForSample(reports.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: reports.length,
    evidence: [
      `Overall observed land-drop rate was ${percent(summary.landDropRate)}.`,
      `${affected.length}/${reports.length} games missed at least one available land drop, with ${missed} missed turns total.`,
    ],
  };
}

function stuckCardFindings(
  reports: WorkbenchGameTelemetry[],
  summary: WorkbenchDeckTestSummary,
): WorkbenchDiagnosticFinding[] {
  const minimumGames = Math.max(2, Math.ceil(reports.length * 0.3));
  return Object.entries(summary.stuckCardGames)
    .filter(([, games]) => games >= minimumGames)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([name, games]) => ({
      id: `stuck-card:${name}`,
      category: "deck" as const,
      title: `Repeatedly stuck: ${name}`,
      confidence: confidenceForSample(reports.length, games),
      gamesAffected: games,
      gamesEvaluated: reports.length,
      evidence: [
        `${name} remained in hand across at least three own-turn transitions in ${games}/${reports.length} games (${percent(games / reports.length)}).`,
      ],
    }));
}

function aiReliabilityFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const affected = reports.filter(
    (report) => report.errors > 0 || (report.manualRecoveries ?? 0) > 0,
  );
  if (affected.length === 0) return null;
  const errors = reports.reduce((sum, report) => sum + report.errors, 0);
  const recoveries = reports.reduce(
    (sum, report) => sum + (report.manualRecoveries ?? 0),
    0,
  );
  return {
    id: "ai-reliability",
    category: "pilot",
    title: "AI reliability",
    confidence: confidenceForSample(reports.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: reports.length,
    evidence: [
      `${affected.length}/${reports.length} games required an AI error or manual recovery.`,
      `Observed ${errors} AI errors and ${recoveries} manual recoveries.`,
    ],
  };
}

function commandZoneRuleFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const affected = reports.filter(
    (report) => (report.pilotRuleAssumptionRisks?.length ?? 0) > 0,
  );
  if (affected.length === 0) return null;
  const examples = affected
    .flatMap((report) => report.pilotRuleAssumptionRisks ?? [])
    .slice(0, 3)
    .map(
      (risk) =>
        `Prompt ${risk.promptId}: referenced ${risk.commanderName}'s ${risk.keyword} while it remained in the command zone.`,
    );
  return {
    id: "command-zone-rule-assumption",
    category: "pilot",
    title: "Command-zone ability assumption",
    confidence: "high",
    gamesAffected: affected.length,
    gamesEvaluated: reports.length,
    evidence: [
      `${affected.length}/${reports.length} games contained combat reasoning that referenced a command-zone commander's battlefield keyword.`,
      ...examples,
    ],
  };
}

function mulliganColorFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const kept = reports.filter((report) => report.keptOpeningHand === true);
  const affected = kept.filter((report) => {
    const required = report.commanderColors ?? [];
    const available = new Set(report.openingManaColors ?? []);
    return required.length > 1 && required.some((color) => !available.has(color));
  });
  if (affected.length === 0) return null;
  return {
    id: "mulligan-color-access-review",
    category: "pilot",
    title: "Mulligan color-access review",
    confidence: confidenceForSample(kept.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: kept.length,
    evidence: [
      `${affected.length}/${kept.length} kept opening hands lacked immediate access to at least one commander color.`,
      "This is a review signal, not proof the keep was wrong; future draws and the hand's other plays still matter.",
    ],
  };
}




function winRate(reports: WorkbenchGameTelemetry[]): number {
  return reports.length === 0 ? 0 : reports.filter((report) => report.won).length / reports.length;
}

function comparativeFinding(args: {
  id: string;
  title: string;
  reports: WorkbenchGameTelemetry[];
  affected: (report: WorkbenchGameTelemetry) => boolean;
  evidenceLabel: string;
  minimumGroup?: number;
}): WorkbenchDiagnosticFinding | null {
  const minimumGroup = args.minimumGroup ?? 4;
  const affected = args.reports.filter(args.affected);
  const comparison = args.reports.filter((report) => !args.affected(report));
  if (affected.length < minimumGroup || comparison.length < minimumGroup) return null;
  const affectedRate = winRate(affected);
  const comparisonRate = winRate(comparison);
  const delta = affectedRate - comparisonRate;
  if (Math.abs(delta) < 0.1) return null;
  return {
    id: args.id,
    category: "deck",
    title: args.title,
    confidence:
      args.reports.length >= 20 && Math.min(affected.length, comparison.length) >= 7
        ? "high"
        : "medium",
    gamesAffected: affected.length,
    gamesEvaluated: args.reports.length,
    evidence: [
      `${args.evidenceLabel}: ${affected.filter((report) => report.won).length}/${affected.length} wins (${percent(affectedRate)}).`,
      `Comparison games: ${comparison.filter((report) => report.won).length}/${comparison.length} wins (${percent(comparisonRate)}).`,
      `Observed difference: ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} percentage points. This is an association, not proof of causation.`,
    ],
  };
}

function comparativeDeckFindings(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding[] {
  if (reports.length < 10) return [];
  const candidates = [
    comparativeFinding({
      id: "impact:commander-late",
      title: "Late commander deployment correlates with results",
      reports,
      affected: (report) =>
        report.commanderName != null &&
        (report.firstCommanderCastTurn == null || report.firstCommanderCastTurn > 5),
      evidenceLabel: "Games without a commander cast by own turn 5",
    }),
    comparativeFinding({
      id: "impact:land-miss",
      title: "Missed land drops correlate with results",
      reports,
      affected: (report) => report.missedLandDropTurns.length > 0,
      evidenceLabel: "Games with at least one observed missed land drop",
    }),
    comparativeFinding({
      id: "impact:no-early-ramp",
      title: "Early ramp correlates with results",
      reports,
      affected: (report) =>
        report.earlyRampPermanentTurn !== undefined &&
        (report.earlyRampPermanentTurn == null || report.earlyRampPermanentTurn > 3),
      evidenceLabel: "Games without observed nonland ramp by own turn 3",
    }),
    comparativeFinding({
      id: "impact:no-interaction-seen",
      title: "Interaction access correlates with results",
      reports,
      affected: (report) =>
        report.interactionCardsSeen !== undefined && report.interactionCardsSeen.length === 0,
      evidenceLabel: "Games where no conservatively detected interaction card was seen",
    }),
    comparativeFinding({
      id: "impact:stuck-card",
      title: "Cards stuck in hand correlate with results",
      reports,
      affected: (report) => report.stuckCards.length > 0,
      evidenceLabel: "Games with at least one card stuck across three own-turn transitions",
    }),
  ];
  return candidates.filter((finding): finding is WorkbenchDiagnosticFinding => finding !== null);
}

function earlyRampFinding(reports: WorkbenchGameTelemetry[]): WorkbenchDiagnosticFinding | null {
  const eligible = reports.filter((report) => report.earlyRampPermanentTurn !== undefined);
  if (eligible.length < 5) return null;
  const affected = eligible.filter(
    (report) => report.earlyRampPermanentTurn == null || report.earlyRampPermanentTurn > 3,
  );
  if (affected.length / eligible.length < 0.5) return null;
  return {
    id: "early-ramp-development",
    category: "deck",
    title: "Limited early ramp development",
    confidence: confidenceForSample(eligible.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: eligible.length,
    evidence: [
      `${affected.length}/${eligible.length} games had no observed nonland mana acceleration on the battlefield by own turn 3 (${percent(affected.length / eligible.length)}).`,
      "This is a development signal, not a recommendation by itself; some commanders and curves need less dedicated ramp than others.",
    ],
  };
}

function interactionAvailabilityFinding(
  reports: WorkbenchGameTelemetry[],
): WorkbenchDiagnosticFinding | null {
  const eligible = reports.filter((report) => report.interactionCardsSeen !== undefined);
  if (eligible.length < 5) return null;
  const affected = eligible.filter((report) => (report.interactionCardsSeen?.length ?? 0) === 0);
  if (affected.length / eligible.length < 0.4) return null;
  return {
    id: "interaction-availability",
    category: "deck",
    title: "Interaction availability",
    confidence: confidenceForSample(eligible.length, affected.length),
    gamesAffected: affected.length,
    gamesEvaluated: eligible.length,
    evidence: [
      `${affected.length}/${eligible.length} games never exposed a card matching the conservative targeted-interaction detector (${percent(affected.length / eligible.length)}).`,
      "The detector covers common destroy, exile, counter, bounce, and targeted-damage wording. It intentionally misses unusual interaction rather than overcounting it.",
    ],
  };
}

function matchupDiagnostics(reports: WorkbenchGameTelemetry[]): WorkbenchMatchupDiagnostic[] {
  const byArchetype = new Map<string, { games: Set<string>; wins: Set<string> }>();
  for (const report of reports) {
    const opponents =
      report.benchmarkOpponents ?? (report.benchmarkOpponent ? [report.benchmarkOpponent] : []);
    for (const opponent of opponents) {
      const bucket = byArchetype.get(opponent.archetype) ?? {
        games: new Set<string>(),
        wins: new Set<string>(),
      };
      bucket.games.add(report.gameId);
      if (report.won) bucket.wins.add(report.gameId);
      byArchetype.set(opponent.archetype, bucket);
    }
  }
  return [...byArchetype.entries()]
    .map(([archetype, bucket]) => {
      const games = bucket.games.size;
      const wins = bucket.wins.size;
      return {
        archetype,
        games,
        wins,
        winRate: games === 0 ? 0 : wins / games,
        confidence: games >= 12 ? ("high" as const) : games >= 5 ? ("medium" as const) : ("low" as const),
      };
    })
    .sort((left, right) => left.winRate - right.winRate || right.games - left.games);
}

function matchupWeaknessFindings(
  reports: WorkbenchGameTelemetry[],
  baseline: number | null,
): WorkbenchDiagnosticFinding[] {
  if (baseline == null) return [];
  return matchupDiagnostics(reports)
    .filter((matchup) => matchup.games >= 5 && matchup.winRate <= baseline - 0.1)
    .slice(0, 3)
    .map((matchup) => ({
      id: `matchup:${matchup.archetype}`,
      category: "deck" as const,
      title: `Weak against ${matchup.archetype} pods`,
      confidence: matchup.confidence,
      gamesAffected: matchup.games - matchup.wins,
      gamesEvaluated: matchup.games,
      evidence: [
        `Won ${matchup.wins}/${matchup.games} games (${percent(matchup.winRate)}) when a ${matchup.archetype} opponent was present.`,
        `Equal-share four-player baseline is ${percent(baseline)}; observed performance was ${Math.round((matchup.winRate - baseline) * 100)} percentage points relative to that baseline.`,
      ],
    }));
}

export function analyzeWorkbenchDeckTest(
  reports: WorkbenchGameTelemetry[],
  summary: WorkbenchDeckTestSummary,
): WorkbenchDeckDiagnostics {
  const deckFindings: WorkbenchDiagnosticFinding[] = [];
  const pilotFindings: WorkbenchDiagnosticFinding[] = [];

  const commanderColor = commanderColorFinding(reports);
  if (commanderColor) pushFinding(deckFindings, commanderColor);
  const commanderDeployment = commanderDeploymentFinding(reports);
  if (commanderDeployment) pushFinding(deckFindings, commanderDeployment);
  const earlyBoard = earlyBoardFinding(reports, summary);
  if (earlyBoard) pushFinding(deckFindings, earlyBoard);
  const landDrops = landDropFinding(reports, summary);
  if (landDrops) pushFinding(deckFindings, landDrops);
  deckFindings.push(...stuckCardFindings(reports, summary));
  const ramp = earlyRampFinding(reports);
  if (ramp) pushFinding(deckFindings, ramp);
  const interaction = interactionAvailabilityFinding(reports);
  if (interaction) pushFinding(deckFindings, interaction);

  const multiplayer = reports.some((report) => (report.benchmarkOpponents?.length ?? 0) >= 3);
  const equalShareBaseline = multiplayer ? 0.25 : null;
  deckFindings.push(...matchupWeaknessFindings(reports, equalShareBaseline));
  deckFindings.push(...comparativeDeckFindings(reports));

  const aiReliability = aiReliabilityFinding(reports);
  if (aiReliability) pushFinding(pilotFindings, aiReliability);
  const commandZoneRule = commandZoneRuleFinding(reports);
  if (commandZoneRule) pushFinding(pilotFindings, commandZoneRule);
  const mulliganColor = mulliganColorFinding(reports);
  if (mulliganColor) pushFinding(pilotFindings, mulliganColor);

  const games = reports.length;
  const sampleStatus = games < 5 ? "insufficient" : games < 12 ? "developing" : "useful";
  const sampleMessage =
    games < 5
      ? `Only ${games} completed game${games === 1 ? "" : "s"}. Run at least ${5 - games} more before treating deck signals as patterns.`
      : games < 12
        ? `${games} completed games provide early signals. Reach 12+ for a more useful diagnostic sample and 20+ for stronger repeated-pattern confidence.`
        : games < 20
          ? `${games} completed games provide a useful diagnostic sample. Reach 20+ to strengthen repeated-pattern confidence.`
          : `${games} completed games provide a strong working sample; matchup-specific findings can still need more games.`;

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sample: {
      games,
      targetForBaseline: 12,
      targetForHighConfidence: 20,
      status: sampleStatus,
      message: sampleMessage,
    },
    benchmark: {
      multiplayer,
      equalShareBaseline,
      winRate: summary.winRate,
      deltaFromBaseline: equalShareBaseline == null ? null : summary.winRate - equalShareBaseline,
      matchups: matchupDiagnostics(reports),
    },
    deckFindings,
    pilotFindings,
  };
}
