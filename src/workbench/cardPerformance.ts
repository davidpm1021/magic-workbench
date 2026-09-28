import type { WorkbenchGameTelemetry } from "./deckTelemetry";

export interface WorkbenchCardPerformance {
  name: string;
  gamesSeen: number;
  gamesCast: number;
  totalCasts: number;
  gamesStuck: number;
  winsWhenSeen: number;
  winsWhenCast: number;
  seenWinRate: number;
  castWinRate: number;
  castWhenSeenRate: number;
  stuckWhenSeenRate: number;
  overallWinRate: number;
  seenWinRateDelta: number;
  sampleConfidence: "insufficient" | "early" | "useful";
}

export function analyzeCardPerformance(
  reports: WorkbenchGameTelemetry[],
): WorkbenchCardPerformance[] {
  const rows = new Map<string, WorkbenchCardPerformance>();
  for (const report of reports) {
    const seen = new Set(report.cardsSeen ?? Object.keys(report.cardsCast));
    for (const stuck of report.stuckCards) seen.add(stuck.name);
    const cast = new Set(Object.keys(report.cardsCast));
    const stuck = new Set(report.stuckCards.map((card) => card.name));
    for (const name of seen) {
      const row = rows.get(name) ?? {
        name,
        gamesSeen: 0,
        gamesCast: 0,
        totalCasts: 0,
        gamesStuck: 0,
        winsWhenSeen: 0,
        winsWhenCast: 0,
        seenWinRate: 0,
        castWinRate: 0,
        castWhenSeenRate: 0,
        stuckWhenSeenRate: 0,
        overallWinRate: 0,
        seenWinRateDelta: 0,
        sampleConfidence: "insufficient",
      };
      row.gamesSeen += 1;
      if (report.won) row.winsWhenSeen += 1;
      if (cast.has(name)) {
        row.gamesCast += 1;
        row.totalCasts += report.cardsCast[name] ?? 0;
        if (report.won) row.winsWhenCast += 1;
      }
      if (stuck.has(name)) row.gamesStuck += 1;
      rows.set(name, row);
    }
  }
  const overallWinRate = reports.length ? reports.filter((report) => report.won).length / reports.length : 0;
  return [...rows.values()]
    .map((row) => {
      const seenWinRate = row.gamesSeen ? row.winsWhenSeen / row.gamesSeen : 0;
      return {
        ...row,
        seenWinRate,
        castWinRate: row.gamesCast ? row.winsWhenCast / row.gamesCast : 0,
        castWhenSeenRate: row.gamesSeen ? row.gamesCast / row.gamesSeen : 0,
        stuckWhenSeenRate: row.gamesSeen ? row.gamesStuck / row.gamesSeen : 0,
        overallWinRate,
        seenWinRateDelta: seenWinRate - overallWinRate,
        sampleConfidence: row.gamesSeen >= 12 ? ("useful" as const) : row.gamesSeen >= 5 ? ("early" as const) : ("insufficient" as const),
      };
    })
    .sort(
      (left, right) =>
        right.gamesStuck - left.gamesStuck ||
        right.gamesSeen - left.gamesSeen ||
        left.name.localeCompare(right.name),
    );
}
