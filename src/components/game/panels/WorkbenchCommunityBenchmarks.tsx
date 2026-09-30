import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchArchidektBenchmarks } from "@/lib/archidekt";
import {
  selectRepresentativeBenchmarks,
  toCommunityBenchmark,
  type CommunityBenchmarkDeck,
  loadCommunityBenchmarkDeck,
} from "@/workbench/communityBenchmarks";
import { useGameStore } from "@/stores/useGameStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";

export function WorkbenchCommunityBenchmarks() {
  const [bracket, setBracket] = useState(3);
  const [decks, setDecks] = useState<CommunityBenchmarkDeck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [suiteGames, setSuiteGames] = useState(16);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void searchArchidektBenchmarks({ bracket, pageSize: 40, minViews: 100 })
      .then((results) => {
        if (active) setDecks(results.map(toCommunityBenchmark));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bracket, generation]);

  const suite = useMemo(
    () => selectRepresentativeBenchmarks(decks, 8, bracket),
    [decks, bracket],
  );

  const startBenchmark = async (benchmark: CommunityBenchmarkDeck) => {
    const state = useGameStore.getState();
    const localSlot = state.myPlayerSlot ?? "player-0";
    const playerDeck =
      state.gameDecks[localSlot] ??
      state.gameDecks["player-0"] ??
      Object.values(state.gameDecks)[0];
    if (!playerDeck) {
      setError("Start a Forge game with the deck you want to test first.");
      return;
    }
    setStartingId(benchmark.id);
    setError(null);
    try {
      const opponent = await loadCommunityBenchmarkDeck(benchmark);
      await state.endGame();
      const started = await useGameStore.getState().startGame(
        playerDeck,
        "commander",
        playerDeck.commanders?.[0]?.identity.name,
        [opponent],
        "Forge",
      );
      if (!started) throw new Error("Forge could not start the benchmark matchup.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingId(null);
    }
  };

  const startSuite = async () => {
    const state = useGameStore.getState();
    const localSlot = state.myPlayerSlot ?? "player-0";
    const playerDeck =
      state.gameDecks[localSlot] ??
      state.gameDecks["player-0"] ??
      Object.values(state.gameDecks)[0];
    if (!playerDeck || suite.length === 0) {
      setError("Start a Forge game with the deck you want to benchmark first.");
      return;
    }
    setStartingId("suite");
    setError(null);
    try {
      const first = await loadCommunityBenchmarkDeck(suite[0]);
      await state.endGame();
      const started = await useGameStore.getState().startGame(
        playerDeck,
        "commander",
        playerDeck.commanders?.[0]?.identity.name,
        [first],
        "Forge",
      );
      if (!started) throw new Error("Forge could not start the benchmark suite.");
      useWorkbenchStore.getState().startDeckTest(
        suiteGames,
        suite.map((deck) => ({
          id: deck.id,
          name: deck.name,
          sourceUrl: deck.sourceUrl,
          archetype: deck.archetype,
          bracket: deck.bracket,
        })),
      );
      useWorkbenchStore.getState().setControllerMode("thinking-ai");
      useWorkbenchStore.getState().setStatus({
        kind: "paused",
        message: `Benchmark suite started: game 1/${suiteGames} vs ${suite[0].name}.`,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingId(null);
    }
  };

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Community benchmarks</p>
          <p className="text-[10px] text-muted-foreground">
            Popular public Archidekt Commander decks for realistic matchup testing.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={loading}
          onClick={() => setGeneration((value) => value + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <label className="block space-y-1">
        <span className="text-[10px] text-muted-foreground">Comparable Commander bracket</span>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          value={bracket}
          onChange={(event) => setBracket(Number(event.target.value))}
        >
          <option value={1}>1 · Exhibition</option>
          <option value={2}>2 · Core</option>
          <option value={3}>3 · Upgraded</option>
          <option value={4}>4 · Optimized</option>
          <option value={5}>5 · cEDH</option>
        </select>
      </label>
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      {loading ? <p className="text-[10px] text-muted-foreground">Loading benchmark pool…</p> : null}
      {!loading && !error && suite.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No complete popular decks were returned for this bracket.
        </p>
      ) : null}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] text-muted-foreground">Suite games</span>
          <input
            type="number"
            min="1"
            max="1000"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            value={suiteGames}
            onChange={(event) => setSuiteGames(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
          />
        </label>
        <Button
          size="sm"
          variant="primary"
          className="self-end h-8 px-3 text-[11px]"
          disabled={loading || startingId !== null || suite.length === 0}
          onClick={() => void startSuite()}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Run suite
        </Button>
      </div>
      <div className="space-y-1">
        {suite.map((deck) => (
          <div
            key={deck.id}
            className="flex items-center gap-2 rounded-md border border-border/50 bg-background/60 p-2 text-[10px]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{deck.name}</p>
              <p className="truncate text-muted-foreground">
                {deck.author} · {deck.archetype} · {(deck.views ?? 0).toLocaleString()} views
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5"
              disabled={startingId !== null}
              title="Start this benchmark matchup"
              onClick={() => void startBenchmark(deck)}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <a
              href={deck.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Open ${deck.name} on Archidekt`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Candidate searches are cached locally for six hours to avoid hammering Archidekt. Pick a deck
        with the play button to replace the current opponent, then use Start batch below to repeat
        that exact sourced matchup. The suite is deterministic and rotates across archetypes.
      </p>
    </section>
  );
}
