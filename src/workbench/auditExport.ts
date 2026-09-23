import type { WorkbenchAuditEntry } from "@/stores/useWorkbenchStore";

export interface WorkbenchAuditPayload {
  schemaVersion: 2;
  exportedAt: string;
  gameId: string;
  result?: {
    winnerId: string | null;
    turn: number;
  };
  summary: {
    entries: number;
    paidAiCalls: number;
    errors: number;
    humanRecoveries: number;
    estimatedCostUsd: number;
  };
  entries: WorkbenchAuditEntry[];
}

export function buildWorkbenchAuditPayload(args: {
  gameId: string;
  entries: WorkbenchAuditEntry[];
  winnerId?: string | null;
  turn?: number;
}): WorkbenchAuditPayload {
  const { gameId, entries } = args;
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    gameId,
    ...(typeof args.turn === "number"
      ? {
          result: {
            winnerId: args.winnerId ?? null,
            turn: args.turn,
          },
        }
      : {}),
    summary: {
      entries: entries.length,
      paidAiCalls: entries.filter((entry) => entry.source === "ai").length,
      errors: entries.filter((entry) => entry.status === "error").length,
      humanRecoveries: entries.filter((entry) => entry.source === "human").length,
      estimatedCostUsd: entries.reduce(
        (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
        0,
      ),
    },
    entries,
  };
}

export function downloadWorkbenchAudit(args: {
  gameId: string;
  entries: WorkbenchAuditEntry[];
  winnerId?: string | null;
  turn?: number;
  filenamePrefix?: string;
}): void {
  const payload = buildWorkbenchAuditPayload(args);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${args.filenamePrefix ?? "magic-workbench-audit"}-${args.gameId}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
