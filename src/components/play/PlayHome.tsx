import { Download, FlaskConical, Layers, Play, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { downloadWorkbenchAudit } from "@/workbench/auditExport";
import { formatUsd } from "@/workbench/pricing";

export function PlayHome() {
  const lastCompletedGame = useWorkbenchStore((state) => state.lastCompletedGame);
  const auditLog = useWorkbenchStore((state) => state.auditLog);
  const runtimeErrors = useWorkbenchStore((state) => state.runtimeErrors);
  const deckTestSession = useWorkbenchStore((state) => state.deckTestSession);
  const completedAuditEntries = lastCompletedGame
    ? auditLog.filter((entry) => entry.gameId === lastCompletedGame.gameId)
    : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-9">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Magic Workbench
          </p>
          <h1 className="mt-1 font-serif text-3xl font-light sm:text-4xl">
            Test the deck. Find the problem. Make it better.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Import or open one of your decks, launch it in Forge, then use Thinking AI and
            community benchmark suites to collect repeatable deck-performance evidence.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          <Button asChild variant="primary" className="h-auto justify-start gap-3 p-4 text-left">
            <Link to={ROUTES.DECK_EDITOR}>
              <Layers className="h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">My Decks</span>
                <span className="block text-xs font-normal opacity-80">
                  Import, open, and manage the decks you want to test.
                </span>
              </span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start gap-3 p-4 text-left">
            <Link to={ROUTES.PLAY_OFFLINE_CONSTRUCTED}>
              <Play className="h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">Start a Test Game</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Choose your deck and launch Forge against a test opponent.
                </span>
              </span>
            </Link>
          </Button>
        </section>

        {deckTestSession.status !== "idle" ? (
          <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex items-start gap-3">
              <FlaskConical className="mt-0.5 h-5 w-5 text-primary" />
              <div className="min-w-0">
                <p className="font-semibold">Current deck test</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {deckTestSession.status} · {deckTestSession.reports.length}/
                  {deckTestSession.targetGames} games complete
                  {(deckTestSession.benchmarkOpponents?.length ?? 0) > 0
                    ? ` · ${deckTestSession.benchmarkOpponents?.length} community opponents`
                    : ""}
                </p>
                {deckTestSession.error ? (
                  <p className="mt-1 text-xs text-destructive">{deckTestSession.error}</p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {lastCompletedGame && completedAuditEntries.length > 0 ? (
          <section className="rounded-xl border border-border/60 bg-muted/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">Last completed Workbench game</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Turn {lastCompletedGame.turn} · {lastCompletedGame.paidAiCalls} AI calls ·
                    {" "}{formatUsd(lastCompletedGame.estimatedCostUsd)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lastCompletedGame.entries} audited decisions · {lastCompletedGame.errors} AI
                    errors · {runtimeErrors.length} captured runtime errors
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadWorkbenchAudit({
                    gameId: lastCompletedGame.gameId,
                    entries: completedAuditEntries,
                    winnerId: lastCompletedGame.winnerId,
                    turn: lastCompletedGame.turn,
                    filenamePrefix: "magic-workbench-completed",
                    runtimeErrors,
                  })
                }
              >
                <Download className="mr-1.5 h-4 w-4" />
                Export audit
              </Button>
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-border/60 p-4">
          <p className="font-semibold">Workflow</p>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
            <div><strong className="text-foreground">1.</strong> Open deck</div>
            <div><strong className="text-foreground">2.</strong> Start Forge</div>
            <div><strong className="text-foreground">3.</strong> Run benchmark</div>
            <div><strong className="text-foreground">4.</strong> Review evidence</div>
          </div>
        </section>
      </div>
    </div>
  );
}
