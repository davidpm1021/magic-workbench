import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchArchidektBenchmarks } from "@/lib/archidekt";
import {
  selectRepresentativeBenchmarks,
  toCommunityBenchmark,
  type CommunityBenchmarkDeck,
} from "@/workbench/communityBenchmarks";

export function WorkbenchCommunityBenchmarks() {
  const [bracket, setBracket] = useState(3);
  const [decks, setDecks] = useState<CommunityBenchmarkDeck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

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
        Candidate searches are cached locally for six hours to avoid hammering Archidekt. The
        displayed suite is deterministic and rotates across archetypes before repeating one.
      </p>
    </section>
  );
}
