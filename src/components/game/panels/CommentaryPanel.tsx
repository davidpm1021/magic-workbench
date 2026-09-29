import { useMemo } from "react";
import type { GameLogEntry } from "@/types/gameLog";
import { usePreferencesStore, type CommentaryMode } from "@/stores/usePreferencesStore";

interface CommentaryPanelProps {
  gameLog: GameLogEntry[];
  resolvePlayerName: (id: string) => string;
}

function important(entry: GameLogEntry): boolean {
  return entry.entryType === "action" || entry.entryType === "stack" || entry.entryType === "rule" || entry.entryType === "warning";
}

function sentence(entry: GameLogEntry, resolvePlayerName: (id: string) => string): string {
  const actor = entry.playerId ? resolvePlayerName(entry.playerId) : "";
  const prefix = actor && !entry.message.toLowerCase().startsWith(actor.toLowerCase()) ? `${actor}: ` : "";
  return `${prefix}${entry.message}`;
}

export function CommentaryPanel({ gameLog, resolvePlayerName }: CommentaryPanelProps) {
  const mode = usePreferencesStore((state) => state.commentaryMode);
  const setMode = usePreferencesStore((state) => state.setCommentaryMode);
  const entries = useMemo(() => {
    const source = mode === "full" ? gameLog : gameLog.filter(important);
    return source.slice(-5).reverse();
  }, [gameLog, mode]);

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">Commentary</p>
          <p className="text-[9px] text-muted-foreground">Engine-grounded play-by-play</p>
        </div>
        <select
          className="h-7 rounded border border-border bg-background px-1.5 text-[10px]"
          value={mode}
          onChange={(event) => setMode(event.target.value as CommentaryMode)}
        >
          <option value="off">Off</option>
          <option value="key">Key events</option>
          <option value="full">Full commentary</option>
        </select>
      </div>
      {mode !== "off" ? (
        <div className="mt-2 space-y-1.5" aria-live="polite">
          {entries.length > 0 ? entries.map((entry, index) => (
            <div
              key={`${entry.sequence ?? entry.timestampMs}-${index}`}
              className={`rounded-md px-2 py-1.5 text-[10px] leading-relaxed ${index === 0 ? "bg-background font-medium text-foreground" : "text-muted-foreground"}`}
            >
              <span className="mr-1 font-mono text-[9px] opacity-60">#{entry.sequence ?? "?"}</span>
              {sentence(entry, resolvePlayerName)}
            </div>
          )) : (
            <p className="text-[10px] text-muted-foreground">Waiting for the next engine event…</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
