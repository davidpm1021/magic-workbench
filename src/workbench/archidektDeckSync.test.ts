import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeckStore } from "@/stores/useDeckStore";

describe("external deck sync metadata", () => {
  beforeEach(() => {
    useDeckStore.setState({ savedDecks: [] });
  });

  it("persists Archidekt source metadata and replaces the same saved deck in place", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    const deck = {
      name: "Linked deck",
      format: "commander",
      cards: [],
      sideboard: [],
      attractions: [],
      contraptions: [],
      schemes: [],
      planes: [],
    } as never;
    const source = {
      provider: "archidekt" as const,
      deckId: "123",
      url: "https://archidekt.com/decks/123",
      lastSyncedAt: 1,
      fingerprint: "old",
    };
    const id = useDeckStore.getState().addSavedDeck(deck, source);
    expect(id).toBe("00000000-0000-4000-8000-000000000001");
    expect(useDeckStore.getState().savedDecks).toHaveLength(1);
    expect(useDeckStore.getState().savedDecks[0].externalSource?.deckId).toBe("123");

    useDeckStore.getState().replaceSavedDeckFromExternal(
      id,
      Object.assign({}, deck, { name: "Updated linked deck" }),
      { ...source, lastSyncedAt: 2, fingerprint: "new" },
    );
    expect(useDeckStore.getState().savedDecks).toHaveLength(1);
    expect(useDeckStore.getState().savedDecks[0].deck.name).toBe("Updated linked deck");
    expect(useDeckStore.getState().savedDecks[0].externalSource?.fingerprint).toBe("new");
  });
});
