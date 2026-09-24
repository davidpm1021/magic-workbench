import { useMemo, useState } from "react";
import { BarChart3, Download, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/stores/useGameStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  downloadWorkbenchDeckTest,
  summarizeWorkbenchDeckTest,
} from "@/workbench/deckTelemetry";
import { formatUsd } from "@/workbench/pricing";

export function WorkbenchDeckTestPanel() {
  const gameView = useGameStore((state) => state.gameView);
  const deckTestSession = useWorkbenchStore((state) => state.deckTestSession);
  const setControllerMode = useWorkbenchStore((state) => state.setControllerMode);
  const setStatus = useWorkbenchStore((state) => state.setStatus);
  const startDeckTest = useWorkbenchStore((state) => state.startDeckTest);
  const stopDeckTest = useWorkbenchStore((state) => state.stopDeckTest);
  const clearDeckTest = useWorkbenchStore((state) => state.clearDeckTest);
  const [targetGames, setTargetGames] = useState(10);

  const summary = useMemo(
    () => summarizeWorkbenchDeckTest(deckTestSession.reports),
    [deckTestSession.reports],
  );
  const running = deckTestSession.status === "running";

  const start = () => {
    if (!gameView || gameView.gameOver) return;
    const target = Math.max(1, Math.min(1000, Math.round(targetGames)));
    setTargetGames(target);
    startDeckTest(target);
    setControllerMode("thinking-ai");
    setStatus({
      kind: "paused",
      message: `Deck test armed for ${target} game(s). The current game is game 1 and Thinking AI will run the seat.`,
    });
  };

  const stop = () => {
    stopDeckTest();
    setControllerMode("manual");
    setStatus({
      kind: "idle",
      message: "Deck test stopped. Manual control restored for the current game.",
    });
  };

  const exportReport = () => {
    if (deckTestSession.reports.length === 0) return;
    downloadWorkbenchDeckTest({
      reports: deckTestSession.reports,
      targetGames: deckTestSession.targetGames,
      startedAt: deckTestSession.startedAt,
    });
  };

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <div>
          <p className="font-semibold">Deck test lab</p>
          <p className="text-[10px] text-muted-foreground">
            Repeat this exact Forge matchup and collect structured game telemetry.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground">Games</span>
          <input
            type="number"
            min="1"
            max="1000"
            step="1"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 pointer-coarse:text-base"
            value={targetGames}
            disabled={running}
            onChange={(event) =>
              setTargetGames(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))
            }
          />
        </label>
        {running ? (
          <Button
            size="sm"
            variant="secondary"
            className="self-end h-8 px-3 text-[11px]"
            onClick={stop}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            className="self-end h-8 px-3 text-[11px]"
            disabled={!gameView || gameView.gameOver}
            onClick={start}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Start batch
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border/50 bg-background/60 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">
            {deckTestSession.status === "running"
              ? "Running"
              : deckTestSession.status === "completed"
                ? "Completed"
                : deckTestSession.status === "error"
                  ? "Stopped on error"
                  : deckTestSession.status === "stopped"
                    ? "Stopped"
                    : "Ready"}
          </span>
          <span>
            {deckTestSession.reports.length}/{deckTestSession.targetGames}
          </span>
        </div>
        {deckTestSession.error ? (
          <p className="mt-1 text-[10px] text-destructive">{deckTestSession.error}</p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            The current game counts as game 1. Between games Workbench ends the session,
            relaunches the same decks in Forge, and resumes Thinking AI automatically.
          </p>
        )}
      </div>

      {deckTestSession.reports.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">Wins</span>
              <span className="font-semibold">
                {summary.wins}/{summary.games} ({(summary.winRate * 100).toFixed(0)}%)
              </span>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">Avg game turn</span>
              <span className="font-semibold">{summary.averageGameTurn.toFixed(1)}</span>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">First nonland permanent</span>
              <span className="font-semibold">
                {summary.averageFirstNonlandPermanentTurn == null
                  ? "none"
                  : `turn ${summary.averageFirstNonlandPermanentTurn.toFixed(1)}`}
              </span>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">No board by turn 4</span>
              <span className="font-semibold">
                {(summary.noNonlandPermanentByTurn4Rate * 100).toFixed(0)}%
              </span>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">Avg max lands</span>
              <span className="font-semibold">
                {summary.averageMaxLandsOnBattlefield.toFixed(1)}
              </span>
            </div>
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <span className="block text-muted-foreground">AI cost</span>
              <span className="font-semibold">
                {formatUsd(summary.totalEstimatedCostUsd)}
              </span>
            </div>
          </div>

          {Object.keys(summary.stuckCardGames).length > 0 ? (
            <div className="rounded-md border border-border/50 bg-background/60 p-2">
              <p className="font-medium">Cards repeatedly stuck in hand</p>
              <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                {Object.entries(summary.stuckCardGames)
                  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                  .slice(0, 5)
                  .map(([name, games]) => (
                    <div key={name} className="flex justify-between gap-2">
                      <span className="truncate">{name}</span>
                      <span>
                        {games}/{summary.games}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-[11px]"
              onClick={exportReport}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-[11px]"
              disabled={running}
              onClick={clearDeckTest}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </>
      ) : null}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        v1 development metrics use your deck's own turns. The raw export also preserves Forge's
        global engine turn. Opening hand and cards drawn are observational, based on the cards the
        client actually sees, and the export keeps every per-game measurement for later weakness analysis.
      </p>
    </section>
  );
}
