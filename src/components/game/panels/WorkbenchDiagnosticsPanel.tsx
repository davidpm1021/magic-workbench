import { AlertTriangle, Bot, Layers3 } from "lucide-react";
import type {
  WorkbenchDeckDiagnostics,
  WorkbenchDiagnosticFinding,
} from "@/workbench/deckDiagnostics";

interface WorkbenchDiagnosticsPanelProps {
  diagnostics: WorkbenchDeckDiagnostics;
}

function Finding({ finding }: { finding: WorkbenchDiagnosticFinding }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{finding.title}</p>
        <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">
          {finding.confidence}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {finding.gamesAffected}/{finding.gamesEvaluated} game
        {finding.gamesEvaluated === 1 ? "" : "s"} affected
      </p>
      <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
        {finding.evidence.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

export function WorkbenchDiagnosticsPanel({
  diagnostics,
}: WorkbenchDiagnosticsPanelProps) {
  const hasFindings =
    diagnostics.deckFindings.length > 0 || diagnostics.pilotFindings.length > 0;

  if (!hasFindings) {
    return (
      <div className="rounded-md border border-border/50 bg-background/60 p-2 text-[10px] text-muted-foreground">
        No diagnostic signals yet. More completed games may be needed before a pattern appears.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-primary" />
        <p className="font-medium">Diagnostics v1</p>
      </div>

      {diagnostics.deckFindings.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Layers3 className="h-3 w-3" />
            Deck signals
          </div>
          {diagnostics.deckFindings.map((finding) => (
            <Finding key={finding.id} finding={finding} />
          ))}
        </div>
      ) : null}

      {diagnostics.pilotFindings.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Bot className="h-3 w-3" />
            Pilot/system signals
          </div>
          {diagnostics.pilotFindings.map((finding) => (
            <Finding key={finding.id} finding={finding} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
