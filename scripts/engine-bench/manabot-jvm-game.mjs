#!/usr/bin/env node
// Plays `manabot-game.mjs`'s game against the harness jar instead of the Web
// Image: the Manabot wasm answers its seats in-process, the JVM hosts Forge.
// The JVM runs a whole game in seconds where the wasm engine takes minutes,
// and it needs no Web Image toolchain, so a harness change can be read
// against the real bot before a preview build exists. Not a latency reading.
//
//   node scripts/harness.mjs build
//   node scripts/engine-bench/manabot-jvm-game.mjs --seed 7001 --forge-ai-seats 1,3
//   node scripts/engine-bench/manabot-jvm-game.mjs --seats 2 --decks a,b --hints --disagreements d.jsonl
//
// --hints asks the harness for Forge's own pick on every chooseAction prompt
// (aiScore, bench-only) and counts how often the bot agrees; --disagreements
// writes each prompt where it did not, with the bot's view, for rule mining.
// --decisions writes every hinted prompt as feature rows for `manabot-train`;
// --model plays with a trained weight file instead of the hand-written scorer;
// --raw keeps every hinted prompt with its view so `manabot-featurize` can
// rebuild the rows after a featurizer change without replaying games.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const presets = join(root, "public", "preset_decks");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const wasmDir = resolve(option("wasm", join(root, "src", "wasm")));
const jar = resolve(
  option("jar", join(root, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar")),
);
const java = option("java", process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : "java");
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");
const seatCount = Number(option("seats", deckNames.length));
const seed = Number(option("seed", 7015));
const forgeAiSeats = option("forge-ai-seats", "").split(",").filter(Boolean).map(Number);
const hints = process.argv.includes("--hints");
const disagreements = option("disagreements", null);
const decisions = option("decisions", null);
const modelFile = option("model", null);
const rawLog = option("raw", null);
const trace = process.argv.includes("--trace");
const timeoutS = Number(option("timeout", 900));
const output = option("out", null);
const sysprops = process.argv.flatMap((arg, i) =>
  arg === "--sysprop" ? [`-D${process.argv[i + 1]}`] : [],
);

const frontFace = (name) => (name.includes(" // ") ? name.slice(0, name.indexOf(" // ")) : name);

function loadDeck(name) {
  const raw = JSON.parse(readFileSync(join(presets, `${name}.json`), "utf8"));
  const cards = raw.cards.flatMap((entry) => {
    const card = { name: frontFace(entry.name) };
    if (entry.set) card.setCode = entry.set;
    if (entry.cardNumber) card.collectorNumber = entry.cardNumber;
    return Array(entry.count ?? 1).fill(card);
  });
  return { cards, commander: raw.commander ? frontFace(raw.commander) : null, format: raw.format };
}

const decks = Array.from({ length: seatCount }, (_, i) =>
  loadDeck(deckNames[i % deckNames.length]),
);
const commanderGame = decks[0].format === "commander";
const botSeats = decks.map((_, i) => i).filter((i) => !forgeAiSeats.includes(i));
if (botSeats.length === 0) throw new Error("at least one Manabot seat is required");

const wasm = await import(pathToFileURL(join(wasmDir, "wasm.js")).href);
await wasm.default({ module_or_path: readFileSync(join(wasmDir, "wasm_bg.wasm")) });
const bots = new Map(botSeats.map((seat) => [seat, new wasm.WasmManabot()]));
if (modelFile) {
  const model = readFileSync(modelFile, "utf8");
  for (const bot of bots.values()) bot.set_model(model);
}

const jvm = spawn(
  java,
  [
    ...sysprops,
    "-jar",
    jar,
    "--interactive-server",
    "--forge-home",
    join(root, "forge", "forge-gui"),
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const stderr = [];
const stderrFile = option("stderr", null);
jvm.stderr.on("data", (chunk) => {
  if (stderrFile) appendFileSync(stderrFile, chunk);
  for (const line of String(chunk).split("\n")) {
    if (line.includes("[mana-brew]") || line.includes("Exception") || line.includes("[harness]"))
      stderr.push(line);
  }
});
const lines = createInterface({ input: jvm.stdout });
const pending = [];
lines.on("line", (line) => {
  if (line.startsWith('{"ok"')) pending.shift()?.(JSON.parse(line));
});
const call = (body) =>
  new Promise((resolveReply, reject) => {
    pending.push((reply) =>
      reply.ok ? resolveReply(reply.result) : reject(new Error(reply.error)),
    );
    jvm.stdin.write(`${JSON.stringify(body)}\n`);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const request = {
  gameId: "bench",
  variant: commanderGame ? "Commander" : "Constructed",
  startingLife: Number(option("starting-life", commanderGame ? 40 : 20)),
  seed,
  players: decks.map((deck, i) => ({
    name: forgeAiSeats.includes(i) ? `Forge AI ${i + 1}` : `Manabot ${i + 1}`,
    ai: forgeAiSeats.includes(i),
    hints: hints && !forgeAiSeats.includes(i),
    deck: deck.cards,
    commanderNames: commanderGame && deck.commander ? [deck.commander] : [],
  })),
};

const session = JSON.parse(
  await call({ command: "startGame", payload: JSON.stringify(request) }),
).sessionId;
const startedAt = Date.now();
const seats = Object.fromEntries(
  botSeats.map((seat) => [
    seat,
    {
      prompts: 0,
      acts: 0,
      passes: 0,
      hinted: 0,
      hintAgreed: 0,
      hintDisagreed: 0,
      combatHinted: 0,
      combatAgreed: 0,
      botMs: 0,
      blunders: {},
    },
  ]),
);
let lastPromptId = null;
let turn = 0;
let reason = "game_over";
while (true) {
  if (Date.now() - startedAt > timeoutS * 1000) {
    reason = "timeout";
    break;
  }
  const raw = await call({ command: "getPrompt", sessionId: session, playerIndex: 0 });
  const prompt = raw ? JSON.parse(raw) : null;
  if (!prompt || prompt.promptId === lastPromptId) {
    if ((await call({ command: "getGameOver", sessionId: session })).trim() === "true") break;
    await sleep(2);
    continue;
  }
  lastPromptId = prompt.promptId;
  const seat = Number(String(prompt.decidingPlayerId).slice("player-".length));
  const bot = bots.get(seat);
  if (!bot) continue;
  const stats = seats[seat];
  stats.prompts += 1;
  const view = await call({ command: "getSnapshot", sessionId: session, viewer: seat });
  const started = performance.now();
  bot.observe_state(`{"checkpointId":0,"label":"forge","gameView":${view}}`);
  const parsedView = JSON.parse(view);
  turn = parsedView?.turn ?? turn;
  const decided = bot.decide(JSON.stringify(prompt));
  stats.botMs += performance.now() - started;
  if (!decided) {
    reason = `unanswered:${prompt.input?.type}`;
    break;
  }
  const action = JSON.parse(decided);
  if (trace) {
    process.stderr.write(
      `${turn} ${parsedView?.step} seat${seat} ${prompt.input?.type} ${prompt.input?.presentation?.title ?? ""} -> ${JSON.stringify(action.output).slice(0, 4000)}\n`,
    );
  }
  for (const kind of blunders(prompt, parsedView, action.output, `player-${seat}`)) {
    stats.blunders[kind] = (stats.blunders[kind] ?? 0) + 1;
  }
  if (prompt.input?.type === "chooseAction") {
    const actions = prompt.input.actions ?? [];
    const chosen =
      action.output?.type === "act" ? actions.find((a) => a.id === action.output.actionId) : null;
    if (chosen) stats.acts += 1;
    else stats.passes += 1;
    const ranked = actions.filter((a) => a.aiScore != null);
    const candidates = actions.filter((a) => a.type !== "undoMana" && !a.isManaAbility);
    if (ranked.length && candidates.length) {
      stats.hinted += 1;
      const forgePick = actions.find((a) => a.aiScore > 0) ?? null;
      const name = (a) => (a ? (a.label ?? a.description ?? a.id) : null);
      const agreed = name(chosen) === name(forgePick) || (chosen && chosen.aiScore == null);
      if (decisions) {
        const { units } = JSON.parse(bot.features(JSON.stringify(prompt)));
        const forgeId = forgePick ? forgePick.id : null;
        const chosenId = chosen ? chosen.id : null;
        logDecision("chooseAction", parsedView, seat, units[0], forgeId, chosenId, (id) =>
          id === null ? "pass" : name(actions.find((a) => a.id === id)),
        );
      }
      if (agreed) stats.hintAgreed += 1;
      else {
        stats.hintDisagreed += 1;
        if (disagreements) {
          appendFileSync(
            disagreements,
            `${JSON.stringify({ seed, seat, turn, step: parsedView?.step, bot: chosen?.label ?? chosen?.description ?? null, forge: forgePick?.label ?? forgePick?.description ?? null, actions: candidates.map((a) => [a.label ?? a.description, a.aiScore]), view: parsedView })}\n`,
          );
        }
      }
    }
  }
  if (
    rawLog &&
    (prompt.input?.aiAssignments || prompt.input?.actions?.some((a) => a.aiScore != null))
  ) {
    appendFileSync(
      rawLog,
      `${JSON.stringify({ seed, seat, turn, step: parsedView?.step, view: parsedView, prompt, output: action.output })}\n`,
    );
  }
  if (decisions && prompt.input?.aiAssignments) {
    const kind = prompt.input.type;
    const { units } = JSON.parse(bot.features(JSON.stringify(prompt)));
    const mine = action.output?.assignments ?? [];
    const ai = prompt.input.aiAssignments;
    for (const unit of units) {
      const attacking = kind === "chooseAttackers";
      const key = attacking ? "attackerId" : "blockerId";
      const value = attacking ? "targetId" : "attackerId";
      const forgeId = ai.find((a) => a[key] === unit.unit)?.[value] ?? null;
      const chosenId = mine.find((a) => a[key] === unit.unit)?.[value] ?? null;
      stats.combatHinted += 1;
      if (forgeId === chosenId) stats.combatAgreed += 1;
      logDecision(kind, parsedView, seat, unit, forgeId, chosenId, (id) => id ?? "none");
    }
  }
  await call({ command: "submitAction", sessionId: session, payload: JSON.stringify(action) });
}

// Behaviour-health counters: the things a person would call stupid, read off
// the view and the bot's answer. Not a win-rate proxy; a list of complaints.
function blunders(prompt, view, output, me) {
  const found = [];
  if (!view || !output) return found;
  const input = prompt.input ?? {};
  const cards = new Map();
  for (const zone of view.zones ?? [])
    for (const card of zone.cards ?? [])
      if (card.visibility === "visible")
        cards.set(card.id, { ...card, zone: zone.zone, owner: zone.ownerId });
  const stat = (v) => Number.parseInt(v ?? "", 10) || 0;
  const creatures = (owner) =>
    [...cards.values()].filter(
      (c) => c.zone === "battlefield" && c.owner === owner && c.types.includes("Creature"),
    );
  const oppCreatures = [...cards.values()].filter(
    (c) => c.zone === "battlefield" && c.owner !== me && c.types.includes("Creature"),
  );
  const myLife = view.players.find((p) => p.id === me)?.life ?? 0;
  const ownTurn = view.activePlayerId === me;
  const stackEmpty = (view.stack ?? []).length === 0;
  const kills = (a, b) =>
    stat(a.power) > 0 &&
    (a.keywords.includes("Deathtouch") || stat(a.power) >= stat(b.toughness) - (b.damage ?? 0)) &&
    !b.keywords.includes("Indestructible");
  if (input.type === "chooseAction") {
    const actions = input.actions ?? [];
    const chosen = output.type === "act" ? actions.find((a) => a.id === output.actionId) : null;
    const castable = actions.filter((a) => a.type === "cast" && !a.label?.startsWith("Play "));
    const landDrop = actions.find((a) => a.type === "cast" && a.label?.startsWith("Play "));
    if (!chosen && ownTurn && view.step === "main2" && stackEmpty) {
      if (landDrop) found.push("land_not_played");
      if (
        castable.some((a) =>
          (cards.get(a.cardId)?.types ?? []).some((t) =>
            ["Creature", "Artifact", "Enchantment", "Planeswalker"].includes(t),
          ),
        )
      )
        found.push("idle_with_castable");
    }
    if (chosen?.type === "cast") {
      const card = cards.get(chosen.cardId);
      const text = (card?.text ?? "").toLowerCase();
      if (
        card &&
        (text.includes("destroy target creature") || text.includes("exile target creature")) &&
        oppCreatures.length === 0
      )
        found.push("removal_no_target");
      if (card && text.startsWith("counter target") && stackEmpty) found.push("counter_no_stack");
      if (
        card &&
        card.types.includes("Instant") &&
        ownTurn &&
        (view.step === "upkeep" || view.step === "draw") &&
        stackEmpty
      )
        found.push("instant_at_upkeep");
    }
  }
  if (input.type === "chooseAttackers") {
    const assigned = output.assignments ?? [];
    const totalPower = assigned.reduce((sum, a) => sum + stat(cards.get(a.attackerId)?.power), 0);
    for (const a of assigned) {
      const attacker = cards.get(a.attackerId);
      const targetLife = view.players.find((p) => p.id === a.targetId)?.life;
      if (!attacker || targetLife == null || totalPower >= targetLife) continue;
      const blockers = creatures(a.targetId).filter((b) => !b.tapped);
      const suicidal = blockers.some((b) => kills(b, attacker) && !kills(attacker, b));
      if (
        suicidal &&
        !attacker.keywords.some((k) =>
          ["Flying", "Trample", "Menace", "Indestructible", "Deathtouch"].includes(k),
        )
      )
        found.push("attack_into_losing_block");
    }
  }
  if (input.type === "chooseBlockers") {
    const assigned = output.assignments ?? [];
    const incoming = (input.attackers ?? []).reduce(
      (sum, a) => sum + stat(cards.get(a.attackerId)?.power),
      0,
    );
    const blockedIds = new Set(assigned.map((b) => b.attackerId));
    const unblocked = (input.attackers ?? [])
      .filter((a) => !blockedIds.has(a.attackerId))
      .reduce((sum, a) => sum + stat(cards.get(a.attackerId)?.power), 0);
    const usedBlockers = new Set(assigned.map((b) => b.blockerId));
    const blockable = (input.attackers ?? []).some(
      (a) =>
        !blockedIds.has(a.attackerId) &&
        (a.validBlockerIds ?? []).some((id) => !usedBlockers.has(id)),
    );
    if (unblocked >= myLife && myLife > 0 && blockable) found.push("no_block_lethal");
    for (const b of assigned) {
      const blocker = cards.get(b.blockerId);
      const attacker = cards.get(b.attackerId);
      if (!blocker || !attacker) continue;
      if (kills(attacker, blocker) && !kills(blocker, attacker) && myLife - incoming >= 15)
        found.push("chump_at_high_life");
    }
  }
  return found;
}

function logDecision(kind, parsedView, seat, unit, forgeId, chosenId, describe) {
  const label = unit.cands.findIndex((c) => c.id === forgeId);
  if (label === -1) return;
  const bot = unit.cands.findIndex((c) => c.id === chosenId);
  appendFileSync(
    decisions,
    `${JSON.stringify({
      kind,
      seed,
      seat,
      turn,
      step: parsedView?.step,
      unit: unit.unit,
      label,
      bot: bot === -1 ? null : bot,
      names: unit.cands.map((c) => describe(c.id)),
      cands: unit.cands.map((c) => c.feats),
    })}\n`,
  );
}

const finalView = JSON.parse(
  (await call({ command: "getSnapshot", sessionId: session, viewer: 0 })) || "{}",
);
jvm.stdin.write('{"command":"quit"}\n');
for (const bot of bots.values()) bot.free();
const life = (finalView?.players ?? []).map((p) => p.life);
const alive = (finalView?.players ?? []).filter((p) => !p.hasLost && p.life > 0).map((p) => p.id);
const result = {
  seed,
  decks: deckNames.slice(0, seatCount),
  forgeAiSeats,
  hints,
  reason,
  turn,
  seconds: Math.round((Date.now() - startedAt) / 1000),
  life,
  lost: (finalView?.players ?? []).filter((p) => p.hasLost).map((p) => p.id),
  winner: alive.length === 1 ? alive[0] : null,
  seats,
  engineWarnings: stderr.slice(0, 20),
};
console.log(JSON.stringify(result, null, 2));
if (output) writeFileSync(output, JSON.stringify(result, null, 2));
