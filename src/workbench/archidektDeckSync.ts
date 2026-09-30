import { fetchArchidektDeck } from "@/lib/archidekt";
import { resolveDeckTextImport } from "@/components/editor/useDeckTextImport";
import { useDeckStore, type SavedDeck } from "@/stores/useDeckStore";
import type { EditorDeck } from "@/types/manabrew";

function fingerprintDeck(deck: EditorDeck): string {
  const rows = [
    ...(deck.commanders ?? []).map((card) => `C|${card.identity.name}`),
    ...deck.cards.map((card) => `M|${card.identity.name}`),
  ].sort();
  return rows.join("\n");
}

async function resolveArchidektEditorDeck(deckId: string): Promise<{ deck: EditorDeck; fingerprint: string }> {
  const source = await fetchArchidektDeck(deckId);
  const entries = [
    ...source.commanders.map((card) => ({
      name: card.name,
      count: card.count,
      commander: true,
      side: false,
      maybe: false,
      setCode: card.set,
      collectorNumber: card.cardNumber,
    })),
    ...source.cards.map((card) => ({
      name: card.name,
      count: card.count,
      commander: false,
      side: false,
      maybe: false,
      setCode: card.set,
      collectorNumber: card.cardNumber,
    })),
  ];
  const resolved = await resolveDeckTextImport(entries, () => {});
  if (resolved.notFound.length > 0) {
    throw new Error(`${resolved.notFound.length} Archidekt card(s) could not be resolved`);
  }
  const cardCount = resolved.cards.length + resolved.commanders.length;
  if (cardCount !== 100 || resolved.commanders.length === 0) {
    throw new Error(`resolved to ${cardCount}/100 cards with ${resolved.commanders.length} commander(s)`);
  }
  const deck: EditorDeck = {
    name: source.name,
    format: "commander",
    cards: resolved.cards,
    sideboard: resolved.sideboard,
    maybeboard: [],
    commanders: resolved.commanders,
    attractions: [],
    contraptions: [],
    schemes: [],
    planes: [],
  };
  return { deck, fingerprint: fingerprintDeck(deck) };
}

export interface ArchidektRefreshSummary {
  linked: number;
  updated: number;
  unchanged: number;
  failed: Array<{ name: string; error: string }>;
}

export async function refreshArchidektDecks(
  savedDecks: SavedDeck[] = useDeckStore.getState().savedDecks,
): Promise<ArchidektRefreshSummary> {
  const linked = savedDecks.filter((saved) => saved.externalSource?.provider === "archidekt");
  const summary: ArchidektRefreshSummary = {
    linked: linked.length,
    updated: 0,
    unchanged: 0,
    failed: [],
  };
  for (const saved of linked) {
    try {
      const source = saved.externalSource!;
      const resolved = await resolveArchidektEditorDeck(source.deckId);
      const nextSource = {
        ...source,
        lastSyncedAt: Date.now(),
        fingerprint: resolved.fingerprint,
      };
      if (resolved.fingerprint === source.fingerprint) {
        useDeckStore.getState().replaceSavedDeckFromExternal(saved.id, saved.deck, nextSource);
        summary.unchanged += 1;
      } else {
        useDeckStore.getState().replaceSavedDeckFromExternal(saved.id, resolved.deck, nextSource);
        summary.updated += 1;
      }
    } catch (error) {
      summary.failed.push({
        name: saved.deck.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}

export async function importLinkedArchidektDeck(deckId: string): Promise<string> {
  const resolved = await resolveArchidektEditorDeck(deckId);
  return useDeckStore.getState().addSavedDeck(resolved.deck, {
    provider: "archidekt",
    deckId,
    url: `https://archidekt.com/decks/${encodeURIComponent(deckId)}`,
    lastSyncedAt: Date.now(),
    fingerprint: resolved.fingerprint,
  });
}
