#!/usr/bin/env python3
"""Blunder counters over relay captures, for bot seats or human seats.

Same definitions as `blunders()` in manabot-jvm-game.mjs, read off the seat's
view (rebuilt from state patches), the prompt and the response. Output: counts
per 100 seat-games, so a prod bot can be compared with a rig population.

    capture-blunders.py <captures dir> [--since YYYY-MM-DD] [--day YYYY-MM-DD] [--after ISO-8601]
        [--seats bots|humans] [--limit N]
"""
import collections
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "latency"))
from state_delta import SeatStates  # noqa: E402

KINDS = {"chooseAction", "chooseAttackers", "chooseBlockers"}
PERMANENTS = {"Creature", "Artifact", "Enchantment", "Planeswalker"}
EVASION = {"Flying", "Trample", "Menace", "Indestructible", "Deathtouch"}


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def stat(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def kills(a, b):
    return (
        stat(a.get("power")) > 0
        and ("Deathtouch" in a.get("keywords", []) or stat(a.get("power")) >= stat(b.get("toughness")) - (b.get("damage") or 0))
        and "Indestructible" not in b.get("keywords", [])
    )


def blunders(prompt, view, output, me):
    found = []
    inp = prompt.get("input") or {}
    cards = {}
    for zone in view.get("zones") or []:
        for card in zone.get("cards") or []:
            if card.get("visibility") == "visible":
                cards[card["id"]] = dict(card, zone=zone["zone"], owner=zone["ownerId"])
    battlefield = [c for c in cards.values() if c["zone"] == "battlefield"]
    creatures = lambda owner: [c for c in battlefield if c["owner"] == owner and "Creature" in c["types"]]
    opp_creatures = [c for c in battlefield if c["owner"] != me and "Creature" in c["types"]]
    my_life = next((p["life"] for p in view.get("players", []) if p["id"] == me), 0)
    own_turn = view.get("activePlayerId") == me
    stack_empty = not view.get("stack")
    step = view.get("step")
    kind = inp.get("type")
    if kind == "chooseAction":
        actions = inp.get("actions") or []
        chosen = next((a for a in actions if a["id"] == output.get("actionId")), None) if output.get("type") == "act" else None
        source_cards = [
            c
            for c in battlefield
            if c["owner"] == me and not c.get("tapped") and ("Land" in c["types"] or "{t}: add" in c.get("text", "").lower())
        ]
        supply = collections.Counter()
        for c in source_cards:
            for sub, color in (("Plains", "W"), ("Island", "U"), ("Swamp", "B"), ("Mountain", "R"), ("Forest", "G")):
                if sub in c.get("subtypes", []):
                    supply[color] += 1
            for seg in c.get("text", "").split("Add ")[1:]:
                for ch in seg.split(".")[0].split("\n")[0]:
                    if ch in "WUBRG":
                        supply[ch] += 1

        def affordable(card):
            if not card or (card.get("cmc") or 99) > len(source_cards):
                return False
            pips = collections.Counter(ch for ch in (card.get("manaCost") or "") if ch in "WUBRG")
            return all(pips[k] <= supply[k] for k in pips)

        castable = [
            a
            for a in actions
            if a.get("type") == "cast" and not (a.get("label") or "").startswith("Play ") and affordable(cards.get(a.get("cardId")))
        ]
        land_drop = next((a for a in actions if a.get("type") == "cast" and (a.get("label") or "").startswith("Play ")), None)
        if chosen is None and own_turn and step == "main2" and stack_empty:
            if land_drop:
                found.append("land_not_played")
            if any(PERMANENTS & set(cards.get(a.get("cardId"), {}).get("types", [])) for a in castable):
                found.append("idle_with_castable")
        if chosen and chosen.get("type") == "cast":
            card = cards.get(chosen.get("cardId"))
            text = (card or {}).get("text", "").lower()
            if card and ("destroy target creature" in text or "exile target creature" in text) and not opp_creatures:
                found.append("removal_no_target")
            if card and text.startswith("counter target") and stack_empty:
                found.append("counter_no_stack")
            if card and "Instant" in card["types"] and own_turn and step in ("upkeep", "draw") and stack_empty:
                found.append("instant_at_upkeep")
    elif kind == "chooseAttackers":
        assigned = output.get("assignments") or []
        total = sum(stat(cards.get(a["attackerId"], {}).get("power")) for a in assigned)
        for a in assigned:
            attacker = cards.get(a["attackerId"])
            target_life = next((p["life"] for p in view.get("players", []) if p["id"] == a["targetId"]), None)
            if not attacker or target_life is None or total >= target_life:
                continue
            blockers = [b for b in creatures(a["targetId"]) if not b.get("tapped")]
            suicidal = any(kills(b, attacker) and not kills(attacker, b) for b in blockers)
            if suicidal and not EVASION & set(attacker.get("keywords", [])):
                found.append("attack_into_losing_block")
    elif kind == "chooseBlockers":
        assigned = output.get("assignments") or []
        attackers = inp.get("attackers") or []
        incoming = sum(stat(cards.get(a["attackerId"], {}).get("power")) for a in attackers)
        blocked = {b["attackerId"] for b in assigned}
        used = {b["blockerId"] for b in assigned}
        unblocked = sum(stat(cards.get(a["attackerId"], {}).get("power")) for a in attackers if a["attackerId"] not in blocked)
        blockable = any(a["attackerId"] not in blocked and any(i not in used for i in a.get("validBlockerIds", [])) for a in attackers)
        if unblocked >= my_life > 0 and blockable:
            found.append("no_block_lethal")
        for b in assigned:
            blocker, attacker = cards.get(b["blockerId"]), cards.get(b["attackerId"])
            if blocker and attacker and kills(attacker, blocker) and not kills(blocker, attacker) and my_life - incoming >= 15:
                found.append("chump_at_high_life")
    return found


def game(path, want_bots, after=None):
    try:
        raw = subprocess.run(["zstd", "-dcq", path], capture_output=True, timeout=300).stdout
    except Exception:
        return None
    lines = raw.splitlines()
    if len(lines) < 3:
        return None
    try:
        head = json.loads(lines[0])
    except Exception:
        return None
    if head.get("event") != "game_started" or str(head.get("engine", "")).lower() != "forge":
        return None
    if after and str(head.get("ts", "")) < after:
        return None
    players = head.get("players") or []
    if any(str(p.get("username", "")).lower().startswith(("loadtest", "probe")) for p in players):
        return None
    seats = {f"player-{i}" for i, p in enumerate(players) if bool(p.get("is_bot")) == want_bots}
    if not seats:
        return None
    states = SeatStates()
    pending = {}
    counts = collections.Counter()
    prompts = 0
    for line in lines[1:-1]:
        if b'"kind":"state"' in line or b'"kind":"stateDelta"' in line:
            try:
                states.observe(json.loads(line).get("envelope") or {})
            except Exception:
                pass
            continue
        if b'"kind":"prompt"' in line:
            try:
                env = json.loads(line).get("envelope") or {}
            except Exception:
                continue
            seat = env.get("forPlayer")
            prompt = env.get("prompt") or {}
            if seat in seats and (prompt.get("input") or {}).get("type") in KINDS:
                state = states.states.get(seat) or states.states.get("")
                view = (state or {}).get("gameView")
                if view is not None:
                    pending[seat] = (prompt, json.loads(json.dumps(view)))
            continue
        if b'"kind":"response"' in line:
            try:
                env = json.loads(line).get("envelope") or {}
            except Exception:
                continue
            seat = env.get("fromPlayer")
            if seat not in pending:
                continue
            prompt, view = pending.pop(seat)
            output = (env.get("action") or {}).get("output") or {}
            prompts += 1
            for kind in blunders(prompt, view, output, seat):
                counts[kind] += 1
    return len(seats), prompts, counts


def main():
    root = sys.argv[1]
    since = arg("--since", "0000-00-00")
    only = arg("--day")
    after = arg("--after")
    want_bots = arg("--seats", "bots") == "bots"
    limit = int(arg("--limit", "0"))
    seat_games = prompts = games = 0
    total = collections.Counter()
    for day in sorted(os.listdir(root)):
        if day < since or (only and day != only) or not os.path.isdir(os.path.join(root, day)):
            continue
        for name in sorted(os.listdir(os.path.join(root, day))):
            if not name.endswith(".zst"):
                continue
            result = game(os.path.join(root, day, name), want_bots, after)
            if not result:
                continue
            n, p, counts = result
            seat_games += n
            prompts += p
            total.update(counts)
            games += 1
            if limit and games >= limit:
                break
        if limit and games >= limit:
            break
    print(f"games {games}, seat-games {seat_games}, decisions {prompts}")
    for kind, count in sorted(total.items()):
        print(f"  {kind:26s} {100 * count / max(1, seat_games):6.1f} per 100 seat-games")


if __name__ == "__main__":
    main()
