package forge.harness.host;

import forge.ai.ComputerUtilCard;
import forge.ai.LobbyPlayerAi;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameObject;
import forge.game.IEntityMap;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

// Forge's AI answering for an external seat, the way its dev-mode "AI play
// suggestion" and AvailableActions do: the AI controller is swapped in for one
// question only. One PlayerControllerAi per seat, so AI card memory carries
// across prompts.
final class AiHints {
    private static final int HINT_TIMEOUT_SECONDS = 1;
    private static final int PICKED = 100;
    private static final boolean DEBUG = Boolean.getBoolean("manabrew.hintDebug");

    private final Map<Player, PlayerControllerAi> brains = new IdentityHashMap<>();
    private int failures;

    // Parallel to actions: Forge's pick scores PICKED, the rest 0, cards its AI
    // never plays null. Null altogether when Forge had no usable opinion.
    Integer[] rankActions(final Player player, final List<SpellAbility> actions) {
        if (actions.stream().allMatch(SpellAbility::isManaAbility)) {
            final Integer[] scores = new Integer[actions.size()];
            java.util.Arrays.fill(scores, 0);
            return scores;
        }
        final Game game = player.getGame();
        final PlayerControllerAi ai = brain(player);
        final AtomicReference<List<SpellAbility>> picked = new AtomicReference<>();
        final int seatTimeout = game.AI_TIMEOUT;
        game.AI_TIMEOUT = HINT_TIMEOUT_SECONDS;
        final long started = System.currentTimeMillis();
        try {
            player.runWithController(() -> picked.set(ai.chooseSpellAbilityToPlay()), ai);
        } catch (RuntimeException error) {
            if (failures++ < 3) {
                System.err.println("[mana-brew] ai hint failed for " + player.getName() + ": " + error);
            }
            return null;
        } finally {
            game.AI_TIMEOUT = seatTimeout;
        }
        if (DEBUG) {
            System.err.println("[mana-brew] hint " + game.getPhaseHandler().getTurn() + " "
                    + game.getPhaseHandler().getPhase() + " pick=" + picked.get()
                    + " in " + (System.currentTimeMillis() - started) + "ms");
        }
        final Integer[] scores = new Integer[actions.size()];
        for (int i = 0; i < actions.size(); i++) {
            final Card host = actions.get(i).getHostCard();
            scores[i] = host != null && ComputerUtilCard.isCardRemAIDeck(host) ? null : 0;
        }
        if (picked.get() == null || picked.get().isEmpty()) {
            // null both when Forge would pass and when its eval loop ran out of time
            final boolean expired = System.currentTimeMillis() - started >= HINT_TIMEOUT_SECONDS * 1000L;
            return expired ? null : scores;
        }
        boolean matched = false;
        for (final SpellAbility choice : picked.get()) {
            for (int i = 0; i < actions.size(); i++) {
                if (sameAction(actions.get(i), choice)) {
                    scores[i] = PICKED;
                    matched = true;
                }
            }
        }
        return matched ? scores : null;
    }

    // The attack Forge's AI would declare from a fresh Combat, as (attacker,
    // defender) pairs; null when its declaration failed.
    List<Map.Entry<Card, GameEntity>> declareAttackers(final Player player) {
        final PlayerControllerAi ai = brain(player);
        final Combat scratch = new Combat(player);
        try {
            player.runWithController(() -> ai.declareAttackers(player, scratch), ai);
        } catch (RuntimeException error) {
            if (failures++ < 3) {
                System.err.println("[mana-brew] ai attack hint failed for " + player.getName() + ": " + error);
            }
            return null;
        }
        final List<Map.Entry<Card, GameEntity>> pairs = new ArrayList<>();
        for (final Card attacker : scratch.getAttackers()) {
            pairs.add(Map.entry(attacker, scratch.getDefenderByAttacker(attacker)));
        }
        return pairs;
    }

    // The blocks Forge's AI would declare on a copy of the live combat, as
    // (blocker, attacker) pairs; null when its declaration failed.
    List<Map.Entry<Card, Card>> declareBlockers(final Player player, final Combat combat) {
        final PlayerControllerAi ai = brain(player);
        final Combat scratch = new Combat(combat, new IdentityMap(player.getGame()));
        try {
            player.runWithController(() -> ai.declareBlockers(player, scratch), ai);
        } catch (RuntimeException error) {
            if (failures++ < 3) {
                System.err.println("[mana-brew] ai block hint failed for " + player.getName() + ": " + error);
            }
            return null;
        }
        final List<Map.Entry<Card, Card>> pairs = new ArrayList<>();
        for (final Card attacker : scratch.getAttackers()) {
            for (final Card blocker : scratch.getBlockers(attacker)) {
                if (blocker.getController() == player) {
                    pairs.add(Map.entry(blocker, attacker));
                }
            }
        }
        return pairs;
    }

    private PlayerControllerAi brain(final Player player) {
        return brains.computeIfAbsent(player, p ->
                new PlayerControllerAi(p.getGame(), p, new LobbyPlayerAi(p.getName(), null)));
    }

    private static final class IdentityMap implements IEntityMap {
        private final Game game;

        IdentityMap(final Game game) {
            this.game = game;
        }

        @Override
        public Game getGame() {
            return game;
        }

        @Override
        public GameObject map(final GameObject o) {
            return o;
        }
    }

    // alternative-cost abilities are fresh copies on every enumeration
    private static boolean sameAction(final SpellAbility offered, final SpellAbility choice) {
        if (offered == choice) {
            return true;
        }
        if (offered.getHostCard() != choice.getHostCard()) {
            return false;
        }
        if (offered.isSpell() != choice.isSpell() || offered.isLandAbility() != choice.isLandAbility()) {
            return false;
        }
        if (offered.getAlternativeCost() != choice.getAlternativeCost()) {
            return false;
        }
        return offered.toString().equals(choice.toString());
    }
}
