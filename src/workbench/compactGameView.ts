import type { Prompt } from "@/protocol";
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

function compactReferenceCard(card: ClientCardDto) {
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
    tapped: card.tapped,
    attacking: card.isAttacking,
    counters: card.counters,
    damage: card.damage,
  };
}

function promptRelevantCardIds(prompt?: Prompt): Set<string> {
  const ids = new Set<string>();
  if (!prompt) return ids;
  if (prompt.sourceCard?.id) ids.add(prompt.sourceCard.id);

  switch (prompt.input.type) {
    case "chooseAction":
    case "payManaCost":
      for (const action of prompt.input.actions) {
        const cardId = (action as { cardId?: string }).cardId;
        if (cardId) ids.add(cardId);
      }
      if (prompt.input.type === "payManaCost" && prompt.input.cardId) ids.add(prompt.input.cardId);
      break;
    case "chooseBoardTargets":
      for (const target of prompt.input.candidates) {
        if (target.kind === "card") ids.add(target.id);
      }
      break;
    case "chooseCards":
    case "scry":
      for (const card of prompt.input.cards) ids.add(card.id);
      break;
    case "chooseDamageAssignmentOrder":
      ids.add(prompt.input.attackerId);
      for (const id of prompt.input.blockerIds) ids.add(id);
      break;
    case "chooseCombatDamageAssignment":
      ids.add(prompt.input.attackerId);
      for (const id of prompt.input.blockerIds) ids.add(id);
      if (prompt.input.defenderId) ids.add(prompt.input.defenderId);
      break;
    default:
      break;
  }
  return ids;
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

export function compactWorkbenchGameView(view: ClientGameView, prompt?: Prompt) {
  const relevantCardIds = promptRelevantCardIds(prompt);
  const compactLongZoneCard = (card: ClientCardDto) =>
    relevantCardIds.has(card.id) ? compactCard(card) : compactReferenceCard(card);

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
      graveyard: (player.graveyard ?? []).map(compactLongZoneCard),
      exile: (player.exile ?? []).map(compactLongZoneCard),
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
