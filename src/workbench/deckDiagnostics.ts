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

export interface WorkbenchDeckDiagnostics {
  schemaVersion: 1;
  generatedAt: string;
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

  const aiReliability = aiReliabilityFinding(reports);
  if (aiReliability) pushFinding(pilotFindings, aiReliability);
  const commandZoneRule = commandZoneRuleFinding(reports);
  if (commandZoneRule) pushFinding(pilotFindings, commandZoneRule);
  const mulliganColor = mulliganColorFinding(reports);
  if (mulliganColor) pushFinding(pilotFindings, mulliganColor);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    deckFindings,
    pilotFindings,
  };
}
