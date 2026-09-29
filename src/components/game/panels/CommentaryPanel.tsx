import { useMemo } from "react";
import type { GameLogEntry } from "@/types/gameLog";
import { usePreferencesStore, type CommentaryMode } from "@/stores/usePreferencesStore";
import { buildCommentaryBeats } from "@/workbench/commentary";

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
    return source.slice(-20);
  }, [gameLog, mode]);
  const beats = useMemo(() => buildCommentaryBeats(entries).slice(-4).reverse(), [entries]);

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
          {beats.length > 0 ? beats.map((beat, index) => (
            <div
              key={beat.id}
              className={`rounded-md px-2 py-1.5 text-[10px] leading-relaxed ${index === 0 ? "bg-background font-medium text-foreground" : "text-muted-foreground"}`}
            >
              <div>
                <span className="mr-1 font-mono text-[9px] opacity-60">#{beat.sequenceStart ?? "?"}</span>
                {beat.headline}
              </div>
              {mode === "full" && beat.details.length > 0 ? (
                <div className="mt-1 space-y-0.5 border-l border-border/60 pl-2 font-normal text-muted-foreground">
                  {beat.details.slice(-5).map((detail, detailIndex) => <div key={detailIndex}>↳ {detail}</div>)}
                </div>
              ) : null}
            </div>
          )) : (
            <p className="text-[10px] text-muted-foreground">Waiting for the next engine event…</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
