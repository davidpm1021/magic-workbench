import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { buildArchidektBenchmarkCatalog } from "@/lib/archidekt";
import {
  DEFAULT_EXCLUDED_COMMANDERS,
  filterExcludedBenchmarkCommanders,
  loadPlayableCommunityBenchmarks,
  sampleBenchmarkCatalog,
  toCommunityBenchmark,
  type CommunityBenchmarkDeck,
} from "@/workbench/communityBenchmarks";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import type { Deck } from "@/protocol/deck";

interface WorkbenchBenchmarkSetupProps {
  preSelectedDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}

export function WorkbenchBenchmarkSetup({
  preSelectedDeckId,
  onStart,
}: WorkbenchBenchmarkSetupProps) {
  const savedDecks = useOwnedDecks();
  const commanderDecks = savedDecks.filter((entry) => (entry.deck.format ?? "") === "commander");
  const [deckId, setDeckId] = useState(preSelectedDeckId ?? commanderDecks[0]?.id ?? "");
  const [bracket, setBracket] = useState(3);
  const [testMode, setTestMode] = useState<"manual" | "ai-benchmark">("manual");
  const [games, setGames] = useState(16);
  const [candidates, setCandidates] = useState<CommunityBenchmarkDeck[]>([]);
  const [sampleSeed, setSampleSeed] = useState(() => crypto.randomUUID());
  const [excludedCommandersText, setExcludedCommandersText] = useState(() =>
    localStorage.getItem("workbench-excluded-commanders") ?? DEFAULT_EXCLUDED_COMMANDERS.join("\n"),
  );
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preSelectedDeckId) setDeckId(preSelectedDeckId);
  }, [preSelectedDeckId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void buildArchidektBenchmarkCatalog({ bracket, pageSize: 50, minViews: 25, targetSize: 150, maxPages: 12 })
      .then((results) => {
        if (active) setCandidates(results.map(toCommunityBenchmark));
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
  }, [bracket]);

  const excludedCommanders = useMemo(
    () => excludedCommandersText.split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
    [excludedCommandersText],
  );
  const eligibleCandidates = useMemo(
    () => filterExcludedBenchmarkCommanders(candidates, excludedCommanders),
    [candidates, excludedCommanders],
  );
  const suite = useMemo(
    () => sampleBenchmarkCatalog(eligibleCandidates, Math.min(48, eligibleCandidates.length), sampleSeed),
    [eligibleCandidates, sampleSeed],
  );
  const player = commanderDecks.find((entry) => entry.id === deckId);

  async function run() {
    if (!player || suite.length < 3 || starting) return;
    setStarting(true);
    setError(null);
    try {
      // A Commander benchmark is a real four-player pod: the user's deck plus
      // three distinct community opponents. The first pod starts here; the
      // batch controller rotates subsequent pods.
      const skipped: string[] = [];
      const loaded = await loadPlayableCommunityBenchmarks(suite, 3, ({ benchmark, reason }) => {
        skipped.push(`${benchmark.name}: ${reason}`);
        useWorkbenchStore.getState().recordRuntimeError(reason, `benchmark-skip:${benchmark.id}`);
      });
      if (loaded.length < 3) {
        throw new Error(
          `Only ${loaded.length} valid community opponent(s) could be loaded from this pool. ${skipped.slice(0, 2).join(" | ")}`,
        );
      }
      const opponents = loaded.map((item) => item.deck);
      const started = await onStart(
        player.deck,
        opponents,
        "commander",
        player.deck.commanders?.[0]?.identity.name,
      );
      if (!started) throw new Error("Forge could not start the benchmark pod.");
      if (testMode === "ai-benchmark") useWorkbenchStore.getState().startDeckTest(
        games,
        loaded.map((item) => item.benchmark).concat(suite.filter((deck) => !loaded.some((item) => item.benchmark.id === deck.id))).map((deck) => ({
          id: deck.id,
          name: deck.name,
          sourceUrl: deck.sourceUrl,
          archetype: deck.archetype,
          bracket: deck.bracket,
        })),
      );
      if (testMode === "ai-benchmark") {
        useWorkbenchStore.getState().setControllerMode("thinking-ai");
        useWorkbenchStore.getState().setStatus({
          kind: "paused",
          message: `AI benchmark started: game 1/${games}, four-player Bracket ${bracket} pod.`,
        });
      } else {
        useWorkbenchStore.getState().clearDeckTest();
        useWorkbenchStore.getState().setControllerMode("manual");
        useWorkbenchStore.getState().setStatus({
          kind: "idle",
          message: `Manual playtest started against a Bracket ${bracket} community pod. You control your deck.`,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStarting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <header>
          <div className="flex items-center gap-2 text-primary">
            <FlaskConical className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">Commander benchmark</span>
          </div>
          <h1 className="mt-2 font-serif text-3xl font-light">Configure the test</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your deck will play four-player Forge games against rotating popular Archidekt decks
            from the selected Commander bracket.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className={`rounded-xl border p-4 text-left transition ${testMode === "manual" ? "border-primary bg-primary/10" : "border-border/60 bg-muted/20"}`}
            onClick={() => setTestMode("manual")}
          >
            <span className="block font-semibold">Manual Playtest</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              One four-player game. You pilot your deck; Forge pilots the three opponents. No AI takeover or automatic rematch.
            </span>
          </button>
          <button
            type="button"
            className={`rounded-xl border p-4 text-left transition ${testMode === "ai-benchmark" ? "border-primary bg-primary/10" : "border-border/60 bg-muted/20"}`}
            onClick={() => setTestMode("ai-benchmark")}
          >
            <span className="block font-semibold">AI Benchmark</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Thinking AI pilots your deck across many games and rotates community opponents automatically.
            </span>
          </button>
        </section>

        <section className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold">Your deck</span>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={deckId}
              onChange={(event) => setDeckId(event.target.value)}
            >
              <option value="">Choose a Commander deck</option>
              {commanderDecks.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.deck.name}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Commander bracket</span>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
            <label className={`block space-y-1.5 ${testMode === "manual" ? "opacity-40" : ""}`}>
              <span className="text-xs font-semibold">Games</span>
              <input
                type="number"
                min="1"
                max="1000"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={testMode === "manual" ? 1 : games}
                disabled={testMode === "manual"}
                onChange={(event) => setGames(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-border/60 p-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold">Excluded commanders</span>
            <textarea
              rows={3}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs"
              value={excludedCommandersText}
              placeholder="One commander per line"
              onChange={(event) => {
                setExcludedCommandersText(event.target.value);
                localStorage.setItem("workbench-excluded-commanders", event.target.value);
              }}
            />
            <span className="block text-[10px] text-muted-foreground">
              Decks matching these commander names are removed before opponent sampling.
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-border/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Opponent pool</p>
              <p className="text-xs text-muted-foreground">
                {loading ? "Loading Archidekt decks…" : `${eligibleCandidates.length} eligible of ${candidates.length} catalog decks · ${suite.length} sampled`}
              </p>
            </div>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>
          {!loading && suite.length > 0 ? (
            <>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setSampleSeed(crypto.randomUUID())}>
                New opponent sample
              </Button>
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {suite.map((deck) => (
                <div key={deck.id} className="truncate rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                  {deck.name} <span className="text-muted-foreground">· {deck.archetype}</span>
                </div>
              ))}
            </div>
            </>
          ) : null}
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </section>

        <Button
          size="lg"
          variant="primary"
          className="w-full"
          disabled={!player || loading || starting || suite.length < 3}
          onClick={() => void run()}
        >
          {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {starting
            ? "Starting game…"
            : testMode === "manual"
              ? "Start manual 4-player playtest"
              : `Run ${games}-game AI benchmark`}
        </Button>
      </div>
    </div>
  );
}
