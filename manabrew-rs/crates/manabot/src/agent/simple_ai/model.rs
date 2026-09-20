//! Training reads the feature indices this file emits (`WasmManabot::features`),
//! so the featurizer is the contract between `manabot-train` and the bot.

use std::collections::{BTreeSet, HashMap};

use manabrew_agent_interface::prompt::{AgentPrompt, PromptInput};
use manabrew_protocol::prompts::choose_attackers::{AttackerOptionDto, ChooseAttackersInput};
use manabrew_protocol::prompts::choose_blockers::BlockableAttackerDto;
use manabrew_protocol::prompts::common::{
    AttackAssignment, AttackTargetDto, AvailableAction, AvailableActionKind,
};
use serde::Deserialize;

use super::{Combatant, SimpleAi};
use manabrew_agent_interface::game_view_dto::{CardDto, ZoneKind};

pub const DIM: usize = 1 << 18;

pub struct LinearModel {
    kinds: HashMap<String, Vec<f32>>,
}

#[derive(Deserialize)]
struct ModelFile {
    dim: usize,
    kinds: HashMap<String, Vec<(u32, f32)>>,
}

impl LinearModel {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let file: ModelFile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if file.dim != DIM {
            return Err(format!("model dim {} != featurizer dim {DIM}", file.dim));
        }
        let kinds = file
            .kinds
            .into_iter()
            .map(|(kind, sparse)| {
                let mut weights = vec![0.0; DIM];
                for (index, weight) in sparse {
                    weights[index as usize & (DIM - 1)] = weight;
                }
                (kind, weights)
            })
            .collect();
        Ok(Self { kinds })
    }

    pub fn has(&self, kind: &str) -> bool {
        self.kinds.contains_key(kind)
    }

    pub fn score(&self, kind: &str, features: &[u32]) -> f32 {
        let Some(weights) = self.kinds.get(kind) else {
            return 0.0;
        };
        features
            .iter()
            .map(|&index| weights[index as usize & (DIM - 1)])
            .sum()
    }
}

fn fnv1a(text: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in text.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn bucket(value: i32, edges: &[i32]) -> usize {
    edges.iter().filter(|&&edge| value >= edge).count()
}

const STOPWORDS: &[&str] = &[
    "the", "and", "you", "your", "that", "this", "for", "with", "from", "its", "are", "may",
    "then", "until", "any", "all", "each", "one", "two", "three", "into", "onto", "not",
];

fn text_tokens(text: &str) -> BTreeSet<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|word| word.len() >= 3 && !STOPWORDS.contains(word))
        .take(60)
        .map(str::to_string)
        .collect()
}

pub struct PromptContext {
    player_id: String,
    plain: Vec<String>,
    step: String,
    own_turn: bool,
    stack_foreign: bool,
    untapped_mana: i32,
    lands: i32,
    best_opp_creature: usize,
}

#[derive(Default, Clone)]
struct Feats {
    plain: Vec<String>,
    conj: Vec<String>,
}

impl Feats {
    fn plain(&mut self, f: impl Into<String>) {
        self.plain.push(f.into());
    }
    fn conj(&mut self, f: impl Into<String>) {
        self.conj.push(f.into());
    }

    fn hash(&self, ctx: &PromptContext) -> Vec<u32> {
        let mut out = Vec::with_capacity(self.plain.len() + 3 * self.conj.len());
        for token in &self.plain {
            out.push(fnv1a(token));
        }
        for token in &self.conj {
            out.push(fnv1a(token));
            out.push(fnv1a(&format!("{token}|step={}", ctx.step)));
            out.push(fnv1a(&format!("{token}|own={}", ctx.own_turn)));
        }
        out
    }
}

impl SimpleAi {
    pub(crate) fn prompt_context(&self, player_id: &str, candidates: usize) -> PromptContext {
        let view = self.view.as_ref();
        let step = view.map_or("none".to_string(), |v| format!("{:?}", v.step));
        let own_turn = view.is_some_and(|v| v.active_player_id == player_id);
        let stack_foreign =
            view.is_some_and(|v| v.stack.iter().any(|s| s.controller_id != player_id));
        let stack_own = view.is_some_and(|v| v.stack.iter().any(|s| s.controller_id == player_id));
        let turn = view.map_or(0, |v| v.turn as i32);
        let lands = self.lands_in_play(player_id) as i32;
        let untapped_mana = self.available_mana(player_id);
        let my_creatures = self
            .battlefield(player_id)
            .filter(|c| c.types.iter().any(|t| t == "Creature"))
            .count() as i32;
        let opponents: Vec<&str> = view
            .map(|v| {
                v.players
                    .iter()
                    .filter(|p| p.id != player_id)
                    .map(|p| p.id.as_str())
                    .collect()
            })
            .unwrap_or_default();
        let opp_creatures = opponents
            .iter()
            .map(|opp| {
                self.battlefield(opp)
                    .filter(|c| c.types.iter().any(|t| t == "Creature"))
                    .count() as i32
            })
            .sum::<i32>();
        let best_opp_creature_value = opponents
            .iter()
            .flat_map(|opp| self.battlefield(opp))
            .filter(|c| c.types.iter().any(|t| t == "Creature"))
            .map(Self::card_value)
            .max()
            .unwrap_or(0);
        let my_life = view
            .and_then(|v| v.players.iter().find(|p| p.id == player_id))
            .map_or(0, |p| p.life);
        let min_opp_life = view
            .map(|v| {
                v.players
                    .iter()
                    .filter(|p| p.id != player_id && p.life > 0)
                    .map(|p| p.life)
                    .min()
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        let hand = view
            .map(|v| {
                v.zones
                    .iter()
                    .filter(|z| z.zone == ZoneKind::Hand && z.owner_id == player_id)
                    .map(|z| z.count as i32)
                    .sum::<i32>()
            })
            .unwrap_or(0);
        let best_opp_creature = bucket(best_opp_creature_value, &[1, 10, 20, 30, 45]);

        let plain = vec![
            format!("c:step={step}"),
            format!("c:own={own_turn}"),
            format!("c:stackF={stack_foreign}"),
            format!("c:stackO={stack_own}"),
            format!("c:turn={}", bucket(turn, &[2, 4, 6, 8, 11, 15])),
            format!("c:lands={}", bucket(lands, &[1, 2, 3, 4, 5, 6, 8])),
            format!("c:mana={}", bucket(untapped_mana, &[1, 2, 3, 4, 5, 6, 8])),
            format!("c:myc={}", bucket(my_creatures, &[1, 2, 3, 5, 8])),
            format!("c:oppc={}", bucket(opp_creatures, &[1, 2, 4, 6, 9])),
            format!("c:bestopp={best_opp_creature}"),
            format!("c:life={}", bucket(my_life, &[6, 11, 21, 31])),
            format!("c:opplife={}", bucket(min_opp_life, &[6, 11, 21, 31])),
            format!("c:hand={}", bucket(hand, &[1, 2, 4, 6])),
            format!("c:ncand={}", bucket(candidates as i32, &[2, 3, 5, 8])),
        ];
        PromptContext {
            player_id: player_id.to_string(),
            plain,
            step,
            own_turn,
            stack_foreign,
            untapped_mana,
            lands,
            best_opp_creature,
        }
    }

    fn card_feats(&self, card: &CardDto, card_id: &str, ctx: &PromptContext, f: &mut Feats) {
        f.plain(format!("name={}", card.identity.name));
        for ty in &card.types {
            f.conj(format!("type={ty}"));
        }
        for sub in &card.subtypes {
            f.plain(format!("sub={sub}"));
        }
        for kw in &card.keywords {
            f.plain(format!("kw={}", kw.to_ascii_lowercase()));
        }
        f.conj(format!("cmc={}", card.cmc.min(9)));
        f.conj(format!(
            "spare={}",
            bucket(ctx.untapped_mana - card.cmc, &[-2, 0, 1, 2, 4])
        ));
        f.conj(format!(
            "cmcVlands={}",
            bucket(card.cmc - ctx.lands, &[-3, -1, 0, 1])
        ));
        if self.card_zone(card_id) == Some(ZoneKind::Command) {
            f.conj("zone=command");
            f.plain(format!("cmdTax={}", card.commander_tax.unwrap_or(0).min(4)));
        } else if let Some(zone) = self.card_zone(card_id) {
            f.conj(format!("zone={zone:?}"));
        }
        f.plain(format!("color={}", card.color));
        let text = card.text.to_ascii_lowercase();
        for word in text_tokens(&text) {
            f.plain(format!("w={word}"));
        }
        let patterns: &[(&str, &str)] = &[
            ("destroy target", "removal"),
            ("exile target", "removal"),
            ("deals", "damage"),
            ("counter target", "counter"),
            ("draw", "draw"),
            ("search your library", "tutor"),
            ("create", "token"),
            ("return target", "bounce"),
            ("{t}: add", "manarock"),
            ("each opponent", "eachopp"),
            ("until end of turn", "eot"),
            ("flash", "flash"),
            ("sacrifice", "sac"),
            ("enters", "etb"),
        ];
        for (needle, tag) in patterns {
            if text.contains(needle) {
                f.conj(format!("p={tag}"));
                if *tag == "removal" || *tag == "damage" {
                    f.plain(format!("p={tag}|bestopp={}", ctx.best_opp_creature));
                }
                if *tag == "counter" || *tag == "eot" {
                    f.plain(format!("p={tag}|stackF={}", ctx.stack_foreign));
                }
            }
        }
        let power = card.power.as_deref().and_then(|p| p.parse::<i32>().ok());
        if let Some(power) = power {
            f.plain(format!("pow={}", power.clamp(0, 8)));
        }
    }

    pub(crate) fn candidate_features(
        &self,
        action: Option<&AvailableAction>,
        ctx: &PromptContext,
    ) -> Vec<u32> {
        let mut f = Feats::default();
        match action.map(|a| &a.kind) {
            None => {
                f.conj("kind=pass");
                for c in &ctx.plain {
                    f.plain(format!("pass|{c}"));
                }
            }
            Some(AvailableActionKind::Cast {
                card_id,
                mode,
                label,
            }) => {
                let card = self.card(card_id);
                let is_land = label.starts_with("Play ")
                    || card.is_some_and(|c| c.types.iter().any(|t| t == "Land"));
                f.conj(if is_land { "kind=land" } else { "kind=cast" });
                f.plain(format!("mode={mode:?}"));
                if let Some(card) = card {
                    self.card_feats(card, card_id, ctx, &mut f);
                }
                if !is_land {
                    for c in &ctx.plain {
                        f.plain(format!("cast|{c}"));
                    }
                }
            }
            Some(AvailableActionKind::ActivateAbility(info)) => {
                f.conj("kind=ability");
                if let Some(card) = self.card(&info.card_id) {
                    f.plain(format!("name={}", card.identity.name));
                    f.plain(format!(
                        "abil={}|{}",
                        card.identity.name, info.ability_index
                    ));
                    for ty in &card.types {
                        f.conj(format!("atype={ty}"));
                    }
                }
                let desc = info.description.to_ascii_lowercase();
                for word in text_tokens(&desc) {
                    f.plain(format!("aw={word}"));
                }
                f.conj(format!("acost={}", info.cost.is_some()));
                f.conj(format!("asac={}", desc.contains("sacrifice")));
                f.conj(format!("atap={}", desc.contains("{t}")));
                for c in &ctx.plain {
                    f.plain(format!("abil|{c}"));
                }
            }
            Some(AvailableActionKind::UndoMana { .. }) => {
                f.conj("kind=undo");
            }
        }
        f.hash(ctx)
    }
}

pub struct FeatureUnit {
    pub unit: Option<String>,
    pub cands: Vec<(Option<String>, Vec<u32>)>,
    pub label: Option<usize>,
}

pub const KIND_ACTION: &str = "chooseAction";
pub const KIND_ATTACKERS: &str = "chooseAttackers";
pub const KIND_BLOCKERS: &str = "chooseBlockers";

impl SimpleAi {
    pub fn set_model(&mut self, json: &str) -> Result<(), String> {
        self.model = Some(LinearModel::from_json(json)?);
        Ok(())
    }

    pub fn has_view(&mut self) -> bool {
        self.ensure_view();
        self.view.is_some()
    }

    pub(crate) fn model_for(&self, kind: &str) -> Option<&LinearModel> {
        self.model.as_ref().filter(|model| model.has(kind))
    }

    pub fn prompt_features(&mut self, prompt: &AgentPrompt) -> (String, Vec<FeatureUnit>) {
        self.ensure_view();
        let player_id = prompt.deciding_player_id.as_str();
        match &prompt.input {
            PromptInput::ChooseAction(input) => {
                let candidates: Vec<&AvailableAction> = input
                    .actions
                    .iter()
                    .filter(|action| Self::scoreable(action))
                    .collect();
                let ctx = self.prompt_context(player_id, candidates.len());
                let mut cands: Vec<(Option<String>, Vec<u32>)> = candidates
                    .iter()
                    .map(|action| {
                        (
                            Some(action.id.clone()),
                            self.candidate_features(Some(action), &ctx),
                        )
                    })
                    .collect();
                cands.push((None, self.candidate_features(None, &ctx)));
                (
                    KIND_ACTION.to_string(),
                    vec![FeatureUnit {
                        unit: None,
                        cands,
                        label: None,
                    }],
                )
            }
            PromptInput::ChooseAttackers(_) => (KIND_ATTACKERS.to_string(), Vec::new()),
            PromptInput::ChooseBlockers(input) => {
                let ctx = self.prompt_context(player_id, input.attackers.len());
                let units = input
                    .available_blocker_ids
                    .iter()
                    .map(|blocker| {
                        self.blocker_unit(
                            blocker,
                            &input.available_blocker_ids,
                            &input.attackers,
                            &ctx,
                        )
                    })
                    .collect();
                (KIND_BLOCKERS.to_string(), units)
            }
            _ => (String::new(), Vec::new()),
        }
    }

    fn creature_feats(prefix: &str, card: &CardDto, f: &mut Feats) {
        let power = Self::stat(card.power.as_deref());
        let toughness = Self::stat(card.toughness.as_deref());
        f.plain(format!("{prefix}name={}", card.identity.name));
        f.conj(format!("{prefix}pow={}", power.clamp(0, 8)));
        f.conj(format!(
            "{prefix}tou={}",
            (toughness - card.damage).clamp(0, 8)
        ));
        f.conj(format!(
            "{prefix}val={}",
            bucket(Self::card_value(card), &[5, 10, 20, 30, 45])
        ));
        for kw in &card.keywords {
            f.conj(format!("{prefix}kw={}", kw.to_ascii_lowercase()));
        }
        let text = card.text.to_ascii_lowercase();
        f.conj(format!(
            "{prefix}atkTrig={}",
            text.contains("whenever") && text.contains(" attacks")
        ));
        f.conj(format!("{prefix}cmdr={}", card.commander_tax.is_some()));
        f.conj(format!("{prefix}sick={}", card.summoning_sick));
        f.conj(format!("{prefix}tapped={}", card.tapped));
    }

    fn pair_feats(prefix: &str, striker: &Combatant, target: &Combatant, f: &mut Feats) {
        f.conj(format!(
            "{prefix}kills={}",
            Self::can_destroy(striker, target)
        ));
        f.conj(format!(
            "{prefix}dies={}",
            Self::can_destroy(target, striker)
        ));
        f.conj(format!(
            "{prefix}trade={}",
            bucket(striker.value - target.value, &[-20, -8, 0, 8, 20])
        ));
    }

    pub(crate) fn attacker_unit(
        &self,
        attacker: &AttackerOptionDto,
        all: &[AttackerOptionDto],
        targets: &[AttackTargetDto],
        set: &[AttackAssignment],
        ctx: &PromptContext,
    ) -> FeatureUnit {
        let card = self.card(&attacker.attacker_id);
        let me = self.combatant(&attacker.attacker_id);
        let mut base = Feats::default();
        base.conj(format!("must={}", attacker.must_attack));
        let set_power: i32 = set
            .iter()
            .filter_map(|a| self.combatant(&a.attacker_id))
            .map(|a| a.power)
            .sum();
        let potential = self
            .battlefield(&ctx.player_id)
            .filter(|c| c.types.iter().any(|t| t == "Creature") && !c.tapped && !c.summoning_sick)
            .count() as i32;
        base.conj(format!("setN={}", (set.len() as i32).min(5)));
        base.conj(format!(
            "setPower={}",
            bucket(set_power, &[1, 4, 8, 15, 25])
        ));
        base.conj(format!(
            "homeAfter={}",
            bucket(potential - set.len() as i32 - 1, &[0, 1, 2, 4])
        ));
        if let Some(card) = card {
            Self::creature_feats("a:", card, &mut base);
        }
        for c in &ctx.plain {
            base.plain(c.clone());
        }
        let my_power: i32 = self
            .battlefield(&ctx.player_id)
            .filter(|c| c.types.iter().any(|t| t == "Creature") && !c.tapped && !c.summoning_sick)
            .map(|c| Self::stat(c.power.as_deref()).max(0))
            .sum();
        let opponents: Vec<String> = self
            .view
            .as_ref()
            .map(|v| {
                v.players
                    .iter()
                    .filter(|p| p.id != ctx.player_id && p.life > 0)
                    .map(|p| p.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        let their_power: i32 = opponents
            .iter()
            .flat_map(|opp| self.battlefield(opp))
            .filter(|c| c.types.iter().any(|t| t == "Creature"))
            .map(|c| Self::stat(c.power.as_deref()).max(0))
            .sum();
        let my_life = self
            .view
            .as_ref()
            .and_then(|v| v.players.iter().find(|p| p.id == ctx.player_id))
            .map_or(0, |p| p.life);
        base.conj(format!(
            "race={}",
            bucket(my_power - their_power, &[-10, -4, 0, 4, 10])
        ));
        base.conj(format!(
            "lifeMargin={}",
            bucket(my_life - their_power, &[-1, 5, 12, 25])
        ));
        base.conj(format!("myPower={}", bucket(my_power, &[1, 4, 8, 15, 25])));
        let valid: Vec<&AttackTargetDto> = targets
            .iter()
            .filter(|t| attacker.valid_target_ids.contains(&t.id))
            .collect();
        let rule_scores: Vec<i32> = valid
            .iter()
            .map(|t| self.attack_target_score(&t.id))
            .collect();
        let lives: Vec<i32> = valid
            .iter()
            .map(|t| {
                self.view
                    .as_ref()
                    .and_then(|v| v.players.iter().find(|p| p.id == t.id))
                    .map_or(i32::MAX, |p| p.life)
            })
            .collect();
        let rule = self
            .rule_attacks(all, targets, &ctx.player_id)
            .into_iter()
            .find(|a| a.attacker_id == attacker.attacker_id)
            .map(|a| a.target_id);
        base.conj(format!("ruleAttacks={}", rule.is_some()));
        let mut cands = Vec::new();
        let mut none = base.clone();
        none.conj("atk=none");
        cands.push((None, none.hash(ctx)));
        for (index, target) in valid.iter().enumerate() {
            let mut f = base.clone();
            f.conj("atk=go");
            let on_target: Vec<&AttackAssignment> =
                set.iter().filter(|a| a.target_id == target.id).collect();
            let power_on_target: i32 = on_target
                .iter()
                .filter_map(|a| self.combatant(&a.attacker_id))
                .map(|a| a.power)
                .sum();
            f.conj(format!("onTarget={}", (on_target.len() as i32).min(4)));
            if let (Some(me), Some(life)) = (&me, lives.get(index).filter(|l| **l != i32::MAX)) {
                f.conj(format!(
                    "lethalWithSet={}",
                    power_on_target + me.power >= *life
                ));
            }
            f.conj(format!(
                "ruleTarget={}",
                rule.as_deref() == Some(target.id.as_str())
            ));
            f.conj(format!("tkind={:?}", target.kind));
            f.conj(format!(
                "tRankRule={}",
                rule_scores
                    .iter()
                    .filter(|&&s| s > rule_scores[index])
                    .count()
                    .min(3)
            ));
            f.conj(format!(
                "tRankLife={}",
                lives.iter().filter(|&&l| l < lives[index]).count().min(3)
            ));
            f.conj(format!(
                "tRuleBest={}",
                rule_scores.iter().all(|&s| s <= rule_scores[index])
            ));
            f.conj(format!("tOrder={}", index.min(3)));
            let life = self
                .view
                .as_ref()
                .and_then(|v| v.players.iter().find(|p| p.id == target.id).map(|p| p.life));
            if let Some(life) = life {
                f.conj(format!("tlife={}", bucket(life, &[6, 11, 21, 31])));
                if let Some(me) = &me {
                    f.conj(format!("lethalAlone={}", me.power >= life));
                }
            }
            let blockers: Vec<Combatant> = self
                .battlefield(&target.id)
                .filter(|c| c.types.iter().any(|t| t == "Creature") && !c.tapped)
                .filter_map(|c| self.combatant(&c.id))
                .collect();
            f.conj(format!(
                "tblockers={}",
                bucket(blockers.len() as i32, &[1, 2, 4, 6])
            ));
            if let Some(me) = &me {
                let killed_by = blockers.iter().filter(|b| Self::can_destroy(b, me)).count();
                let kills = blockers.iter().filter(|b| Self::can_destroy(me, b)).count();
                let safe = blockers
                    .iter()
                    .all(|b| !Self::can_destroy(b, me) || Self::can_destroy(me, b));
                f.conj(format!("killedBy={}", bucket(killed_by as i32, &[1, 2, 4])));
                f.conj(format!("kills={}", bucket(kills as i32, &[1, 2, 4])));
                f.conj(format!("safe={safe}"));
                let outcome = match (killed_by > 0, kills > 0) {
                    (false, _) => "free",
                    (true, true) => "trade",
                    (true, false) => "chump",
                };
                f.conj(format!("atkOutcome={outcome}"));
                f.plain(format!(
                    "atkOutcome={outcome}|tblockers={}",
                    bucket(blockers.len() as i32, &[1, 2, 4, 6])
                ));
                f.plain(format!(
                    "atkOutcome={outcome}|race={}",
                    bucket(my_power - their_power, &[-10, -4, 0, 4, 10])
                ));
                f.plain(format!(
                    "atkOutcome={outcome}|a:val={}",
                    bucket(me.value, &[5, 10, 20, 30, 45])
                ));
                let best = blockers.iter().max_by_key(|b| b.power);
                if let Some(best) = best {
                    Self::pair_feats("vsBest:", me, best, &mut f);
                }
            }
            cands.push((Some(target.id.clone()), f.hash(ctx)));
        }
        FeatureUnit {
            unit: Some(attacker.attacker_id.clone()),
            cands,
            label: None,
        }
    }

    fn attack_step(
        &self,
        input: &ChooseAttackersInput,
        set: &[AttackAssignment],
        ctx: &PromptContext,
    ) -> Vec<(Option<String>, Vec<u32>)> {
        let mut cands = Vec::new();
        let mut stop = Feats::default();
        let set_power: i32 = set
            .iter()
            .filter_map(|a| self.combatant(&a.attacker_id))
            .map(|a| a.power)
            .sum();
        stop.conj("atk=stop");
        stop.conj(format!("setN={}", (set.len() as i32).min(5)));
        stop.conj(format!(
            "setPower={}",
            bucket(set_power, &[1, 4, 8, 15, 25])
        ));
        stop.conj(format!(
            "remaining={}",
            (input.attackers.len() as i32 - set.len() as i32).min(5)
        ));
        for c in &ctx.plain {
            stop.plain(format!("stop|{c}"));
        }
        cands.push((None, stop.hash(ctx)));
        for attacker in input
            .attackers
            .iter()
            .filter(|a| !set.iter().any(|s| s.attacker_id == a.attacker_id))
        {
            let unit =
                self.attacker_unit(attacker, &input.attackers, &input.attack_targets, set, ctx);
            for (target, feats) in unit.cands.into_iter().skip(1) {
                let target = target.unwrap_or_default();
                cands.push((Some(format!("{}>{}", attacker.attacker_id, target)), feats));
            }
        }
        cands
    }

    pub fn attack_steps(
        &mut self,
        prompt: &AgentPrompt,
        truth: &[AttackAssignment],
    ) -> Vec<FeatureUnit> {
        self.ensure_view();
        let PromptInput::ChooseAttackers(input) = &prompt.input else {
            return Vec::new();
        };
        let ctx = self.prompt_context(&prompt.deciding_player_id, input.attackers.len());
        let mut order: Vec<&AttackAssignment> = truth
            .iter()
            .filter(|t| {
                input
                    .attackers
                    .iter()
                    .any(|a| a.attacker_id == t.attacker_id)
            })
            .collect();
        order.sort_by_key(|t| {
            std::cmp::Reverse(self.combatant(&t.attacker_id).map_or(0, |c| c.power))
        });
        let mut set: Vec<AttackAssignment> = Vec::new();
        let mut units = Vec::new();
        for (step, next) in order
            .iter()
            .map(Some)
            .chain(std::iter::once(None))
            .enumerate()
        {
            let cands = self.attack_step(input, &set, &ctx);
            let label = match next {
                None => Some(0),
                Some(next) => {
                    let id = format!("{}>{}", next.attacker_id, next.target_id);
                    cands
                        .iter()
                        .position(|(c, _)| c.as_deref() == Some(id.as_str()))
                }
            };
            let Some(label) = label else {
                break;
            };
            units.push(FeatureUnit {
                unit: Some(step.to_string()),
                cands,
                label: Some(label),
            });
            if let Some(next) = next {
                set.push((*next).clone());
            }
        }
        units
    }

    pub fn attack_agreement(
        &mut self,
        prompt: &AgentPrompt,
        truth: &[AttackAssignment],
    ) -> Option<(usize, usize, usize)> {
        self.ensure_view();
        let PromptInput::ChooseAttackers(input) = &prompt.input else {
            return None;
        };
        let player = prompt.deciding_player_id.clone();
        let model = self.model_for(KIND_ATTACKERS);
        let learned = model.map(|m| self.greedy_attacks(m, input, &player));
        let rule = self.rule_attacks(&input.attackers, &input.attack_targets, &player);
        let pick = |set: &[AttackAssignment], id: &str| {
            set.iter()
                .find(|a| a.attacker_id == id)
                .map(|a| a.target_id.clone())
        };
        let mut model_hits = 0;
        let mut rule_hits = 0;
        for attacker in &input.attackers {
            let want = pick(truth, &attacker.attacker_id);
            if learned
                .as_ref()
                .is_some_and(|set| pick(set, &attacker.attacker_id) == want)
            {
                model_hits += 1;
            }
            if pick(&rule, &attacker.attacker_id) == want {
                rule_hits += 1;
            }
        }
        Some((input.attackers.len(), model_hits, rule_hits))
    }

    pub(crate) fn greedy_attacks(
        &self,
        model: &LinearModel,
        input: &ChooseAttackersInput,
        player_id: &str,
    ) -> Vec<AttackAssignment> {
        let ctx = self.prompt_context(player_id, input.attackers.len());
        let mut set: Vec<AttackAssignment> = Vec::new();
        for _ in 0..input.attackers.len() {
            let cands = self.attack_step(input, &set, &ctx);
            let best = cands
                .iter()
                .filter(|(id, _)| {
                    id.as_ref().is_none_or(|id| {
                        !self
                            .failed_attack_targets
                            .contains(id.split('>').nth(1).unwrap_or_default())
                    })
                })
                .max_by(|x, y| {
                    model
                        .score(KIND_ATTACKERS, &x.1)
                        .total_cmp(&model.score(KIND_ATTACKERS, &y.1))
                });
            match best.and_then(|(id, _)| id.clone()) {
                None => break,
                Some(id) => {
                    let (attacker, target) = id.split_once('>').unwrap_or_default();
                    set.push(AttackAssignment {
                        attacker_id: attacker.to_string(),
                        target_id: target.to_string(),
                    });
                }
            }
        }
        for attacker in input.attackers.iter().filter(|a| a.must_attack) {
            if !set.iter().any(|s| s.attacker_id == attacker.attacker_id) {
                if let Some(target) = attacker.valid_target_ids.first() {
                    set.push(AttackAssignment {
                        attacker_id: attacker.attacker_id.clone(),
                        target_id: target.clone(),
                    });
                }
            }
        }
        set
    }

    pub(crate) fn blocker_unit(
        &self,
        blocker_id: &str,
        all: &[String],
        attackers: &[BlockableAttackerDto],
        ctx: &PromptContext,
    ) -> FeatureUnit {
        let me = self.combatant(blocker_id);
        let mut base = Feats::default();
        if let Some(card) = self.card(blocker_id) {
            Self::creature_feats("b:", card, &mut base);
        }
        let incoming: i32 = attackers
            .iter()
            .filter_map(|a| self.combatant(&a.attacker_id))
            .map(|a| a.power)
            .sum();
        let life = self
            .view
            .as_ref()
            .and_then(|v| v.players.iter().find(|p| p.id == ctx.player_id))
            .map_or(0, |p| p.life);
        base.conj(format!("incoming={}", bucket(incoming, &[1, 4, 8, 15, 25])));
        base.conj(format!(
            "lifeAfter={}",
            bucket(life - incoming, &[-1, 1, 5, 10, 20])
        ));
        base.conj(format!(
            "nAtk={}",
            bucket(attackers.len() as i32, &[1, 2, 4, 6])
        ));
        for c in &ctx.plain {
            base.plain(c.clone());
        }
        let rule = self
            .declare_blockers(attackers, all, &ctx.player_id)
            .into_iter()
            .find(|b| b.blocker_id == blocker_id)
            .map(|b| b.attacker_id);
        base.conj(format!("ruleBlocks={}", rule.is_some()));
        let mut cands = Vec::new();
        let mut none = base.clone();
        none.conj("blk=none");
        cands.push((None, none.hash(ctx)));
        for attacker in attackers
            .iter()
            .filter(|a| a.valid_blocker_ids.iter().any(|b| b == blocker_id))
        {
            let mut f = base.clone();
            f.conj("blk=go");
            f.conj(format!(
                "ruleBlock={}",
                rule.as_deref() == Some(attacker.attacker_id.as_str())
            ));
            f.conj(format!("mustBlock={}", attacker.must_be_blocked));
            if let Some(card) = self.card(&attacker.attacker_id) {
                Self::creature_feats("x:", card, &mut f);
            }
            if let (Some(me), Some(them)) = (&me, self.combatant(&attacker.attacker_id)) {
                Self::pair_feats("vs:", me, &them, &mut f);
                f.conj(format!("absorb={}", bucket(them.power, &[1, 3, 5, 8])));
                f.conj(format!(
                    "lifeIfUnblocked={}",
                    bucket(life - them.power, &[-1, 1, 5, 10])
                ));
                let outcome = match (Self::can_destroy(&them, me), Self::can_destroy(me, &them)) {
                    (false, false) => "wall",
                    (false, true) => "free",
                    (true, true) => "trade",
                    (true, false) => "chump",
                };
                f.conj(format!("blkOutcome={outcome}"));
                f.plain(format!(
                    "blkOutcome={outcome}|lifeAfter={}",
                    bucket(life - incoming, &[-1, 1, 5, 10, 20])
                ));
                f.plain(format!(
                    "blkOutcome={outcome}|x:val={}",
                    bucket(them.value, &[5, 10, 20, 30, 45])
                ));
                f.plain(format!(
                    "blkOutcome={outcome}|b:val={}",
                    bucket(me.value, &[5, 10, 20, 30, 45])
                ));
                let bigger = attackers
                    .iter()
                    .filter_map(|a| self.combatant(&a.attacker_id))
                    .filter(|a| a.power > them.power)
                    .count();
                f.conj(format!("xRankPower={}", bigger.min(3)));
            }
            cands.push((Some(attacker.attacker_id.clone()), f.hash(ctx)));
        }
        FeatureUnit {
            unit: Some(blocker_id.to_string()),
            cands,
            label: None,
        }
    }

    pub(crate) fn scoreable(action: &AvailableAction) -> bool {
        !matches!(
            &action.kind,
            AvailableActionKind::UndoMana { .. }
                | AvailableActionKind::ActivateAbility(
                    manabrew_protocol::prompts::common::ActivatableAbilityInfo {
                        is_mana_ability: true,
                        ..
                    }
                )
        )
    }
}
