// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

let useDeckStore: typeof import("./useDeckStore").useDeckStore;

function card(id: string, setCode: string, cardNumber: string, foil = false): DeckCard {
  return {
    identity: { id, name: "Cast Down", setCode, cardNumber, foil },
    uris: {},
  } as DeckCard;
}

beforeAll(async () => {
  ({ useDeckStore } = await import("./useDeckStore"));
});

afterAll(() => vi.unstubAllGlobals());

describe("Workbench deck disk backup", () => {
  it("writes savedDecks directly to the local backup endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const id = useDeckStore.getState().addSavedDeck({
      name: "Persistent Commander Deck",
      format: "commander",
      cards: [],
      sideboard: [],
    });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          if (url !== "/workbench-data/decks" || init?.method !== "PUT") return false;
          const payload = JSON.parse(String(init.body)) as {
            schemaVersion?: number;
            savedDecks?: Array<{ id?: string; deck?: { name?: string } }>;
          };
          return (
            payload.schemaVersion === 1 &&
            payload.savedDecks?.some(
              (saved) =>
                saved.id === id && saved.deck?.name === "Persistent Commander Deck",
            ) === true
          );
        }),
      ).toBe(true);
    });

    vi.unstubAllGlobals();
  });

  it("does not delete the disk backup when browser persistence is cleared", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    useDeckStore.persist.clearStorage();

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/workbench-data/decks" && init?.method === "DELETE",
      ),
    ).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe("deck printing updates", () => {
  it("changes only copies of the selected printing variant", () => {
    const selected = card("selected-1", "cmr", "112", true);
    const selectedCopy = card("selected-2", "cmr", "112", true);
    const other = card("other", "clb", "119");
    useDeckStore.setState({
      currentDeck: {
        name: "Deck",
        format: "commander",
        cards: [selected, selectedCopy, other],
        sideboard: [],
      },
    });
    const print = {
      name: "Cast Down",
      set: "dom",
      collector_number: "81",
      oracle_id: "oracle",
      finishes: ["nonfoil"],
      image_uris: {
        small: "small",
        normal: "normal",
        large: "large",
        png: "png",
        art_crop: "art",
        border_crop: "border",
      },
    } as ScryfallCard;

    useDeckStore.getState().updatePrintingVariant(selected.identity, print);

    expect(
      useDeckStore.getState().currentDeck.cards.map((entry) => ({
        id: entry.identity.id,
        setCode: entry.identity.setCode,
        cardNumber: entry.identity.cardNumber,
        foil: !!entry.identity.foil,
      })),
    ).toEqual([
      { id: "selected-1", setCode: "dom", cardNumber: "81", foil: false },
      { id: "selected-2", setCode: "dom", cardNumber: "81", foil: false },
      { id: "other", setCode: "clb", cardNumber: "119", foil: false },
    ]);
  });
});
