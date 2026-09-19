#!/usr/bin/env python3
"""Turn relay game captures into the raw rows `manabot-featurize` reads.

One row per human decision on a chooseAction, chooseAttackers or chooseBlockers
prompt: the seat's view at that moment (rebuilt from state patches), the prompt
and the response, plus the game's outcome for that seat. Bot seats, synthetic
players and non-Forge games are skipped. Usernames never leave this script.

    captures-to-raw.py <captures dir> [--since YYYY-MM-DD] [--day YYYY-MM-DD] [--limit N] \
        | manabot-featurize --in - --out rows.jsonl
"""
import json
import os
import subprocess
import sys
import zlib

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "latency"))
from state_delta import SeatStates  # noqa: E402

KINDS = {"chooseAction", "chooseAttackers", "chooseBlockers"}

PLAYER_DEFAULTS = {"hasEnduringStory": False}


def normalise(view):
    """Older captures predate fields the current view schema requires."""
    for player in view.get("players") or []:
        for key, value in PLAYER_DEFAULTS.items():
            player.setdefault(key, value)
    return view


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def game(path):
    try:
        raw = subprocess.run(["zstd", "-dcq", path], capture_output=True, timeout=300).stdout
    except Exception:
        return
    lines = raw.splitlines()
    if len(lines) < 3:
        return
    try:
        head, tail = json.loads(lines[0]), json.loads(lines[-1])
    except Exception:
        return
    if head.get("event") != "game_started" or tail.get("event") != "game_ended":
        return
    if str(head.get("engine", "")).lower() != "forge":
        return
    players = head.get("players") or []
    if any(str(p.get("username", "")).lower().startswith(("loadtest", "probe")) for p in players):
        return
    humans = {f"player-{i}" for i, p in enumerate(players) if not p.get("is_bot")}
    if not humans:
        return
    winner = next(
        (f"player-{i}" for i, p in enumerate(players) if p.get("username") == tail.get("winner")),
        None,
    )
    seed = zlib.crc32(head["game_id"].encode())
    seats = SeatStates()
    pending = {}
    for line in lines[1:-1]:
        if b'"kind":"state"' in line or b'"kind":"stateDelta"' in line:
            try:
                env = json.loads(line).get("envelope") or {}
            except Exception:
                continue
            seats.observe(env)
            continue
        if b'"kind":"prompt"' in line:
            try:
                env = json.loads(line).get("envelope") or {}
            except Exception:
                continue
            seat = env.get("forPlayer")
            prompt = env.get("prompt") or {}
            if seat in humans and (prompt.get("input") or {}).get("type") in KINDS:
                state = seats.states.get(seat) or seats.states.get("")
                view = (state or {}).get("gameView")
                if view is not None:
                    view = normalise(view)
                    pending[seat] = (
                        prompt,
                        view.get("turn"),
                        view.get("step"),
                        json.dumps(view, separators=(",", ":")),
                    )
            continue
        if b'"kind":"response"' in line:
            try:
                env = json.loads(line).get("envelope") or {}
            except Exception:
                continue
            seat = env.get("fromPlayer")
            if seat not in pending:
                continue
            prompt, turn, step, view = pending.pop(seat)
            output = (env.get("action") or {}).get("output")
            if output is None:
                continue
            row = {
                "seed": seed,
                "seat": int(seat.split("-")[1]),
                "turn": turn or 0,
                "step": step,
                "won": winner == seat,
                "reason": tail.get("reason"),
                "prompt": prompt,
                "output": output,
            }
            text = json.dumps(row, separators=(",", ":"))
            yield text[:-1] + ',"view":' + view + "}"


def main():
    root = sys.argv[1]
    since = arg("--since", "0000-00-00")
    only = arg("--day")
    limit = int(arg("--limit", "0"))
    out = sys.stdout
    games = rows = 0
    for day in sorted(os.listdir(root)):
        if day < since or (only and day != only) or not os.path.isdir(os.path.join(root, day)):
            continue
        for name in sorted(os.listdir(os.path.join(root, day))):
            if not name.endswith(".zst"):
                continue
            n = 0
            for text in game(os.path.join(root, day, name)) or ():
                out.write(text)
                out.write("\n")
                n += 1
            rows += n
            games += n > 0
            if limit and games >= limit:
                print(f"{games} games, {rows} rows", file=sys.stderr)
                return
    print(f"{games} games, {rows} rows", file=sys.stderr)


if __name__ == "__main__":
    main()
