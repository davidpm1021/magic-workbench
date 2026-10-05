import { fetchArchidektDeck, type ArchidektDeck } from "@/lib/archidekt";
import { resolveDeckTextImport } from "@/components/editor/useDeckTextImport";
import { useDeckStore, type SavedDeck } from "@/stores/useDeckStore";
import type { EditorDeck } from "@/types/manabrew";


function fingerprintArchidektSource(source: ArchidektDeck): string {
  return [
    ...source.commanders.map((card) => `C|${card.count}|${card.name}`),
    ...source.cards.map((card) => `M|${card.count}|${card.name}`),
  ].sort().join("\n");
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function fingerprintDeck(deck: EditorDeck): string {
  const rows = [
    ...(deck.commanders ?? []).map((card) => `C|${card.identity.name}`),
    ...deck.cards.map((card) => `M|${card.identity.name}`),
  ].sort();
  return rows.join("\n");
}

async function resolveArchidektSource(source: ArchidektDeck): Promise<{ deck: EditorDeck; fingerprint: string }> {
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

async function resolveArchidektEditorDeck(deckId: string): Promise<{ deck: EditorDeck; fingerprint: string }> {
  const source = await withTimeout(fetchArchidektDeck(deckId), 15000, "Archidekt fetch");
  return resolveArchidektSource(source);
}

export interface ArchidektRefreshSummary {
  linked: number;
  updated: number;
  unchanged: number;
  failed: Array<{ name: string; error: string }>;
}

export async function refreshArchidektDecks(
  savedDecks: SavedDeck[] = useDeckStore.getState().savedDecks,
  onProgress?: (completed: number, total: number, name: string) => void,
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
      const external = saved.externalSource!;
      const source = await withTimeout(fetchArchidektDeck(external.deckId), 15000, `Archidekt fetch for ${saved.deck.name}`);
      const rawFingerprint = fingerprintArchidektSource(source);
      // New sync records store a source-list fingerprint. Older records stored
      // the resolved deck fingerprint, so migrate them once by comparing the
      // already-saved deck before paying the Scryfall resolution cost.
      const savedFingerprint = fingerprintDeck(saved.deck);
      if (external.fingerprint === rawFingerprint || external.fingerprint === savedFingerprint) {
        useDeckStore.getState().replaceSavedDeckFromExternal(saved.id, saved.deck, {
          ...external,
          lastSyncedAt: Date.now(),
          fingerprint: rawFingerprint,
        });
        summary.unchanged += 1;
      } else {
        const resolved = await withTimeout(resolveArchidektSource(source), 45000, `Card resolution for ${saved.deck.name}`);
        useDeckStore.getState().replaceSavedDeckFromExternal(saved.id, resolved.deck, {
          ...external,
          lastSyncedAt: Date.now(),
          fingerprint: rawFingerprint,
        });
        summary.updated += 1;
      }
    } catch (error) {
      summary.failed.push({
        name: saved.deck.name,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      onProgress?.(summary.updated + summary.unchanged + summary.failed.length, linked.length, saved.deck.name);
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
    fingerprint: fingerprintArchidektSource(await withTimeout(fetchArchidektDeck(deckId), 15000, "Archidekt fingerprint fetch")),
  });
}
