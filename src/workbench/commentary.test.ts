import { describe, expect, it } from "vitest";
import { buildCommentaryBeats } from "./commentary";
import type { GameLogEntry } from "@/types/gameLog";

function entry(sequence: number, entryType: GameLogEntry["entryType"], message: string): GameLogEntry {
  return { sequence, entryType, message, timestampMs: sequence };
}

describe("commentary causal grouping", () => {
  it("groups a cast through its resulting resolution", () => {
    const beats = buildCommentaryBeats([
      entry(1, "action", "Muldrotha casts Cultivate"),
      entry(2, "stack", "Cultivate put on the stack"),
      entry(3, "rule", "Search library for up to two basic lands"),
      entry(4, "stack", "Cultivate resolved"),
    ]);
    expect(beats).toHaveLength(1);
    expect(beats[0].headline).toContain("casts Cultivate");
    expect(beats[0].details).toHaveLength(3);
    expect(beats[0].sequenceStart).toBe(1);
    expect(beats[0].sequenceEnd).toBe(4);
  });

  it("starts a new causal beat when a trigger is emitted", () => {
    const beats = buildCommentaryBeats([
      entry(1, "action", "Player casts Creature"),
      entry(2, "rule", "Soul Warden triggered"),
      entry(3, "stack", "Soul Warden trigger resolved"),
    ]);
    expect(beats).toHaveLength(2);
    expect(beats[1].headline).toContain("triggered");
  });
});
