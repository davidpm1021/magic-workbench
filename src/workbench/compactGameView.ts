import type { ClientCardDto, ClientGameView } from "@/stores/gameStore.types";

function cardCharacteristicsKey(card: ClientCardDto): string {
  return JSON.stringify({
    name: card.identity.name,
    manaCost: card.manaCost,
    cmc: card.cmc,
    types: card.types,
    subtypes: card.subtypes,
    power: card.power,
    toughness: card.toughness,
    text: card.text,
    keywords: card.keywords,
  });
}

function compactCard(card: ClientCardDto) {
  return {
    id: card.id,
    name: card.identity.name,
    zone: card.zoneId,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    manaCost: card.manaCost,
    cmc: card.cmc,
    types: card.types,
    subtypes: card.subtypes,
    power: card.power,
    toughness: card.toughness,
    text: card.text,
    tapped: card.tapped,
    attacking: card.isAttacking,
    attackTargetId: card.attackTargetId,
    summoningSick: card.summoningSick,
    keywords: card.keywords,
    counters: card.counters,
    damage: card.damage,
    choices: card.choices,
    attachedTo: card.attachedTo,
    attachmentIds: card.attachmentIds,
    commanderTax: card.commanderTax,
    transformed: card.isTransformed,
    faceDown: card.isFaceDown,
  };
}

function compactBattlefield(cards: ClientCardDto[]) {
  const firstByCharacteristics = new Map<string, string>();
  return cards.map((card) => {
    const key = cardCharacteristicsKey(card);
    const firstId = firstByCharacteristics.get(key);
    const full = compactCard(card);
    if (!firstId) {
      firstByCharacteristics.set(key, card.id);
      return full;
    }

    const {
      manaCost: _manaCost,
      cmc: _cmc,
      types: _types,
      subtypes: _subtypes,
      power: _power,
      toughness: _toughness,
      text: _text,
      keywords: _keywords,
      choices: _choices,
      ...state
    } = full;
    return {
      ...state,
      sameCharacteristicsAs: firstId,
    };
  });
}

export function compactWorkbenchGameView(view: ClientGameView) {
  return {
    gameId: view.gameId,
    turn: view.turn,
    step: view.step,
    activePlayerId: view.activePlayerId,
    priorityPlayerId: view.priorityPlayerId,
    gameOver: view.gameOver,
    winnerId: view.winnerId,
    monarchId: view.monarchId,
    initiativeHolderId: view.initiativeHolderId,
    dayTime: view.dayTime,
    activePlaneNames: view.activePlaneNames,
    combatAssignments: view.combatAssignments,
    players: (view.players ?? []).map((player) => ({
      id: player.id,
      name: player.name,
      status: player.status,
      life: player.life,
      handCount: player.handCount,
      libraryCount: player.libraryCount,
      manaPool: player.manaPool,
      counters: player.counters,
      poison: player.poison,
      energyCounters: player.energyCounters,
      experienceCounters: player.experienceCounters,
      radiationCounters: player.radiationCounters,
      ticketCounters: player.ticketCounters,
      commanderDamage: player.commanderDamage,
      commanderCasts: player.commanderCasts,
      landsPlayedThisTurn: player.landsPlayedThisTurn,
      maxLandPlaysPerTurn: player.maxLandPlaysPerTurn,
      cardsDrawnThisTurn: player.cardsDrawnThisTurn,
      playerKeywords: player.playerKeywords,
      hand: (player.hand ?? []).map(compactCard),
      graveyard: (player.graveyard ?? []).map(compactCard),
      exile: (player.exile ?? []).map(compactCard),
      commandZone: (player.commandZone ?? []).map(compactCard),
      visibleLibraryCards: (player.library ?? []).map(compactCard),
    })),
    battlefield: compactBattlefield(view.battlefield ?? []),
    stack: (view.stack ?? []).map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      controllerId: item.controllerId,
      ownerId: item.ownerId,
      name: item.identity.name,
      text: item.text,
      sourceAbilityText: item.sourceAbilityText,
      isPermanentSpell: item.isPermanentSpell,
      targets: item.targets,
    })),
  };
}
