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

function compactModelCard(card: ClientCardDto) {
  const result: Record<string, unknown> = {
    id: card.id,
    name: card.identity.name,
    zone: card.zoneId,
    controllerId: card.controllerId,
    ownerId: card.ownerId,
    manaCost: card.manaCost,
    cmc: card.cmc,
    types: card.types,
    subtypes: card.subtypes,
    text: card.text,
  };
  if (card.power != null) result.power = card.power;
  if (card.toughness != null) result.toughness = card.toughness;
  if (card.tapped) result.tapped = true;
  if (card.isAttacking) result.attacking = true;
  if (card.attackTargetId) result.attackTargetId = card.attackTargetId;
  if (card.summoningSick) result.summoningSick = true;
  if ((card.keywords ?? []).length > 0) result.keywords = card.keywords;
  if (card.counters && Object.keys(card.counters).length > 0) result.counters = card.counters;
  if ((card.damage ?? 0) > 0) result.damage = card.damage;
  if ((card.choices ?? []).length > 0) result.choices = card.choices;
  if (card.attachedTo) result.attachedTo = card.attachedTo;
  if ((card.attachmentIds ?? []).length > 0) result.attachmentIds = card.attachmentIds;
  if ((card.commanderTax ?? 0) > 0) result.commanderTax = card.commanderTax;
  if (card.isTransformed) result.transformed = true;
  if (card.isFaceDown) result.faceDown = true;
  return result;
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

function compactBattlefield(cards: ClientCardDto[], forModel = false) {
  const firstByCharacteristics = new Map<string, string>();
  return cards.map((card) => {
    const key = cardCharacteristicsKey(card);
    const firstId = firstByCharacteristics.get(key);
    const full = forModel ? compactModelCard(card) : compactCard(card);
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
  const forModel = prompt != null;
  const fullCard = (card: ClientCardDto) =>
    forModel ? compactModelCard(card) : compactCard(card);
  const compactLongZoneCard = (card: ClientCardDto) =>
    relevantCardIds.has(card.id) ? fullCard(card) : compactReferenceCard(card);

  return {
    ...(forModel
      ? {
          compactEncoding:
            "Omitted boolean fields are false; omitted arrays/objects are empty; omitted nullable fields are null.",
        }
      : {}),
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
      hand: (player.hand ?? []).map(fullCard),
      graveyard: (player.graveyard ?? []).map(compactLongZoneCard),
      exile: (player.exile ?? []).map(compactLongZoneCard),
      commandZone: (player.commandZone ?? []).map(fullCard),
      visibleLibraryCards: (player.library ?? []).map(fullCard),
    })),
    battlefield: compactBattlefield(view.battlefield ?? [], forModel),
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
