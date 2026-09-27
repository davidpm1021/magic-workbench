import { AlertTriangle, Bot, Layers3, FlaskConical } from "lucide-react";
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
        <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          {finding.confidence} confidence
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

export function WorkbenchDiagnosticsPanel({ diagnostics }: WorkbenchDiagnosticsPanelProps) {
  const delta = diagnostics.benchmark.deltaFromBaseline;

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border/50 bg-background/60 p-2">
        <div className="flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 text-primary" />
          <p className="font-medium">Deck diagnosis</p>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {diagnostics.sample.message}
        </p>
        {diagnostics.benchmark.multiplayer ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded border border-border/40 p-1.5">
              <span className="block text-muted-foreground">4-player win rate</span>
              <strong>{Math.round(diagnostics.benchmark.winRate * 100)}%</strong>
            </div>
            <div className="rounded border border-border/40 p-1.5">
              <span className="block text-muted-foreground">vs equal-share baseline</span>
              <strong>
                {delta == null ? "n/a" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts`}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      {diagnostics.benchmark.matchups.length > 0 ? (
        <div className="rounded-md border border-border/50 bg-background/60 p-2">
          <p className="font-medium">Performance by opponent archetype</p>
          <div className="mt-1 space-y-1 text-[10px]">
            {diagnostics.benchmark.matchups.map((matchup) => (
              <div key={matchup.archetype} className="grid grid-cols-[1fr_auto_auto] gap-2">
                <span className="capitalize">{matchup.archetype}</span>
                <span>{matchup.wins}/{matchup.games}</span>
                <span className="w-8 text-right text-muted-foreground">
                  {Math.round(matchup.winRate * 100)}%
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[9px] text-muted-foreground">
            A game appears in each archetype represented in its pod. These are matchup-presence
            rates, not independent games.
          </p>
        </div>
      ) : null}

      {diagnostics.deckFindings.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-primary" />
            <p className="font-medium">Deck findings</p>
          </div>
          {diagnostics.deckFindings.map((finding) => (
            <Finding key={finding.id} finding={finding} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border/50 bg-background/60 p-2 text-[10px] text-muted-foreground">
          No repeated deck-construction problem has crossed the evidence threshold yet.
        </div>
      )}

      {diagnostics.pilotFindings.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Bot className="h-3 w-3" />
            Pilot/system caveats
          </div>
          {diagnostics.pilotFindings.map((finding) => (
            <Finding key={finding.id} finding={finding} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Layers3 className="h-3 w-3" />
          No pilot/system reliability caveat currently contaminates the sample.
        </div>
      )}
    </div>
  );
}
