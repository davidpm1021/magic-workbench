import type { GameLogEntry } from "@/types/gameLog";

export interface CommentaryBeat {
  id: string;
  headline: string;
  details: string[];
  sequenceStart: number | null;
  sequenceEnd: number | null;
}

function isResolution(entry: GameLogEntry): boolean {
  return entry.entryType === "stack" && /\b(resolv(?:e|es|ed|ing)?)\b/i.test(entry.message);
}
function isTrigger(entry: GameLogEntry): boolean {
  // A trigger being emitted starts a causal beat. A later "trigger resolved"
  // stack entry belongs to that same beat and must not start another one.
  return !isResolution(entry) &&
    (/\btrigger(?:ed|s)?\b/i.test(entry.message) || /triggered ability/i.test(entry.message));
}
function isCast(entry: GameLogEntry): boolean {
  return entry.entryType === "action" && /\b(cast|casts|play|plays|activate|activates)\b/i.test(entry.message);
}

export function buildCommentaryBeats(entries: GameLogEntry[]): CommentaryBeat[] {
  const beats: CommentaryBeat[] = [];
  let current: CommentaryBeat | null = null;
  const flush = () => {
    if (current) beats.push(current);
    current = null;
  };
  for (const entry of entries) {
    if (isCast(entry) || isTrigger(entry)) {
      flush();
      current = {
        id: String(entry.sequence ?? entry.timestampMs),
        headline: entry.message,
        details: [],
        sequenceStart: entry.sequence ?? null,
        sequenceEnd: entry.sequence ?? null,
      };
      continue;
    }
    if (!current) {
      current = {
        id: String(entry.sequence ?? entry.timestampMs),
        headline: entry.message,
        details: [],
        sequenceStart: entry.sequence ?? null,
        sequenceEnd: entry.sequence ?? null,
      };
    } else {
      current.details.push(entry.message);
      current.sequenceEnd = entry.sequence ?? current.sequenceEnd;
    }
    if (isResolution(entry)) flush();
  }
  flush();
  return beats;
}
