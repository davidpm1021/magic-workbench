import { WorkbenchBenchmarkSetup } from "@/components/play/WorkbenchBenchmarkSetup";
import type { Deck } from "@/protocol/deck";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}

export function OfflinePlaySetup({
  preSelectedDeckId,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <WorkbenchBenchmarkSetup
      preSelectedDeckId={preSelectedDeckId}
      onStart={onStart}
    />
  );
}
