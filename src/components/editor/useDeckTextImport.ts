import { useCallback } from "react";
import { toast } from "sonner";
import { scryfallCardKey } from "@/api/scryfall";
import { DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { inferImportedFormat, type ParsedDeckEntry } from "@/lib/deckImport";
import { resolveDeckName } from "@/lib/deckName";
import { getFormat, isCommanderEligible } from "@/lib/formats";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { isNonDeckCard } from "@/lib/decks";
import { useDeckStore } from "@/stores/useDeckStore";
import { showAccountSaveNudge } from "@/components/auth/accountSaveNudge";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import { executeDeckEdit } from "./deckEditor.history";
export interface ResolvedDeckTextImport {
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
  commanders: DeckCard[];
  notFound: string[];
  substitutedPrintings: string[];
  ignoredNonDeckCards: string[];
}
export async function resolveDeckTextImport(
  entries: ParsedDeckEntry[],
  onProgress: (fraction: number) => void,
): Promise<ResolvedDeckTextImport> {
  onProgress(0.05);
  let scryfallMap: Map<string, import("@/types/scryfall").ScryfallCard>;
  let bulkLookupAvailable = true;
  try {
    scryfallMap = await useScryfallStore.getState().fetchCardCollection(
      entries.map((e) => ({
        name: e.name,
        setCode: e.setCode,
        collectorNumber: e.collectorNumber,
      })),
    );
  } catch (collectionError) {
    // Some desktop/browser transport paths can reject Scryfall's POST
    // /cards/collection even though ordinary named-card GETs work. A bulk
    // transport failure must not invalidate an otherwise valid Commander deck.
    console.warn("[import] Scryfall collection lookup failed; falling back to individual names", collectionError);
    bulkLookupAvailable = false;
    scryfallMap = new Map();
    let completed = 0;
    for (const entry of entries) {
      try {
        const card = await useScryfallStore.getState().fetchCardByFuzzyName(entry.name);
        scryfallMap.set(scryfallCardKey(entry.name), card);
      } catch (error) {
        console.warn(`[import] fallback lookup "${entry.name}" failed`, error);
      }
      completed += 1;
      onProgress(0.05 + 0.4 * (completed / Math.max(entries.length, 1)));
    }
  }
  const exactPrintingMisses = entries.filter(
    (entry) =>
      entry.setCode &&
      entry.collectorNumber &&
      !scryfallMap.has(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber)),
  );
  if (exactPrintingMisses.length > 0 && bulkLookupAvailable) {
    try {
      const fallbacks = await useScryfallStore
        .getState()
        .fetchCardCollection(exactPrintingMisses.map((entry) => ({ name: entry.name })));
      for (const [key, card] of fallbacks) scryfallMap.set(key, card);
    } catch (error) {
      // Printing fidelity is optional. If the collection transport fails here,
      // retain the already-resolved name fallback instead of aborting the deck.
      bulkLookupAvailable = false;
      console.warn("[import] printing fallback collection failed; keeping name-resolved cards", error);
    }
  }
  const lookup = (entry: ParsedDeckEntry) => {
    if (entry.setCode && entry.collectorNumber) {
      return (
        scryfallMap.get(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber)) ??
        scryfallMap.get(scryfallCardKey(entry.name))
      );
    }
    return (
      scryfallMap.get(scryfallCardKey(entry.name, entry.setCode)) ??
      scryfallMap.get(scryfallCardKey(entry.name))
    );
  };
  onProgress(0.5);
  onProgress(0.55);
  const stragglers = [
    ...new Set(
      entries
        .filter((entry) => !entry.setCode && !entry.collectorNumber && !lookup(entry))
        .map((entry) => entry.name),
    ),
  ];
  let resolved = 0;
  await Promise.all(
    stragglers.map((n) =>
      useScryfallStore
        .getState()
        .fetchCardByFuzzyName(n)
        .then((sc) => scryfallMap.set(n.toLowerCase(), sc))
        .catch((err) => console.warn(`[import] fuzzy "${n}" failed`, err))
        .finally(() => {
          resolved += 1;
          onProgress(0.55 + 0.35 * (resolved / stragglers.length));
        }),
    ),
  );
  onProgress(0.9);
  const cards: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  const maybeboard: DeckCard[] = [];
  const commanders: DeckCard[] = [];
  const notFound: string[] = [];
  const substitutedPrintings: string[] = [];
  const ignoredNonDeckCards: string[] = [];
  for (const entry of entries) {
    const { count, side, maybe, commander } = entry;
    const sc = lookup(entry);
    if (!sc) {
      notFound.push(entry.name);
      continue;
    }
    const exactPrintingFound =
      !entry.setCode ||
      !entry.collectorNumber ||
      scryfallMap.has(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber));
    if (!exactPrintingFound) substitutedPrintings.push(entry.name);
    const base = scryfallToDeckCard(sc);
    if (isNonDeckCard(base)) {
      ignoredNonDeckCards.push(entry.name);
      continue;
    }
    const inferredCommander = entry.commanderCandidate && isCommanderEligible(base);
    const target =
      commander || inferredCommander ? commanders : side ? sideboard : maybe ? maybeboard : cards;
    for (let i = 0; i < count; i++) {
      target.push({
        ...base,
        identity: { ...base.identity, id: crypto.randomUUID(), foil: entry.foil },
      });
    }
  }
  if (
    cards.length === 0 &&
    sideboard.length === 0 &&
    maybeboard.length === 0 &&
    commanders.length === 0
  ) {
    throw new Error("None of the cards could be found on Scryfall");
  }
  return {
    cards,
    sideboard,
    maybeboard,
    commanders,
    notFound,
    substitutedPrintings,
    ignoredNonDeckCards,
  };
}
export function useDeckTextImport() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      name: string,
      formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
    ): Promise<string> => {
      const customName = name.trim();
      const {
        cards,
        sideboard,
        maybeboard,
        commanders,
        notFound,
        substitutedPrintings,
        ignoredNonDeckCards,
      } = await resolveDeckTextImport(entries, onProgress);
      const deckName = resolveDeckName(customName || DEFAULT_IMPORT_NAME, commanders);
      const importedFormat =
        formatId ??
        (commanders.length > 0
          ? "commander"
          : inferImportedFormat(cards.map((c) => c.identity.name)));
      const format = getFormat(importedFormat);
      const keepsCommanders = format?.deckRules.requiresCommander ?? false;
      const importedCards = keepsCommanders ? cards : [...cards, ...commanders];
      const importedCommanders = keepsCommanders ? commanders : [];
      const id = useDeckStore.getState().addSavedDeck({
        name: deckName,
        format: importedFormat,
        cards: importedCards,
        sideboard,
        maybeboard,
        commanders: importedCommanders,
        draft:
          importedCards.length + importedCommanders.length < (format?.deckRules.minDeckSize ?? 0),
        attractions: [],
        contraptions: [],
        schemes: [],
        planes: [],
      });
      showAccountSaveNudge();
      onProgress(1);
      if (ignoredNonDeckCards.length > 0) {
        const ignored = [...new Set(ignoredNonDeckCards)];
        const shown = ignored.slice(0, 3).join(", ");
        const extra = ignored.length > 3 ? ` +${ignored.length - 3} more` : "";
        toast.warning(`Imported "${deckName}" — skipped non-deck tokens: ${shown}${extra}`);
      } else if (notFound.length > 0) {
        const shown = notFound.slice(0, 3).join(", ");
        const extra = notFound.length > 3 ? ` +${notFound.length - 3} more` : "";
        toast.warning(`Imported "${deckName}" — couldn't find: ${shown}${extra}`);
      } else if (substitutedPrintings.length > 0) {
        toast.warning(
          substitutedPrintings.length === 1
            ? `Imported "${deckName}" with one default printing substitution`
            : `Imported "${deckName}" with ${substitutedPrintings.length} default printing substitutions`,
        );
      } else {
        toast.success(`Imported "${deckName}"`);
      }
      return id;
    },
    [],
  );
}
export function useDeckTextImportIntoCurrent() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      _name: string,
      _formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
    ): Promise<boolean> => {
      const startingSessionId = useDeckStore.getState().editorSessionId;
      const result = await resolveDeckTextImport(entries, onProgress);
      if (useDeckStore.getState().editorSessionId !== startingSessionId) {
        return false;
      }
      executeDeckEdit(`Import card list`, () =>
        useDeckStore.getState().mergeIntoCurrentDeck(result),
      );
      onProgress(1);
      const count =
        result.cards.length +
        result.sideboard.length +
        result.maybeboard.length +
        result.commanders.length;
      if (result.ignoredNonDeckCards.length > 0) {
        const ignored = [...new Set(result.ignoredNonDeckCards)];
        const shown = ignored.slice(0, 3).join(", ");
        const extra = ignored.length > 3 ? ` +${ignored.length - 3} more` : "";
        toast.warning(`Added ${count} cards — skipped non-deck tokens: ${shown}${extra}`);
      } else if (result.notFound.length > 0) {
        const shown = result.notFound.slice(0, 3).join(", ");
        const extra = result.notFound.length > 3 ? ` +${result.notFound.length - 3} more` : "";
        toast.warning(`Added ${count} cards — couldn't find: ${shown}${extra}`);
      } else if (result.substitutedPrintings.length > 0) {
        toast.warning(
          result.substitutedPrintings.length === 1
            ? `Added ${count} cards with one default printing substitution`
            : `Added ${count} cards with ${result.substitutedPrintings.length} default printing substitutions`,
        );
      } else {
        toast.success(`Added ${count} cards to this deck`);
      }
      return true;
    },
    [],
  );
}
