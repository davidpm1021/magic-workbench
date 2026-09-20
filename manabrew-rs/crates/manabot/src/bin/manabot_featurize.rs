use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};

use manabot::BotAgent;
use manabot::SimpleAi;
use manabrew_agent_interface::game_view_dto::GameViewDto;
use manabrew_agent_interface::prompt::{
    AgentPrompt, ChooseActionOutput, ChooseBlockersOutput, PromptInput, PromptOutput,
};
use manabrew_protocol::prompts::common::AttackAssignment;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Raw {
    seed: u64,
    seat: u32,
    turn: u32,
    step: Option<String>,
    view: Value,
    prompt: AgentPrompt,
    output: Value,
    #[serde(default)]
    won: Option<bool>,
    #[serde(default)]
    reason: Option<String>,
}

fn arg(name: &str, fallback: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
        .unwrap_or_else(|| fallback.to_string())
}

fn assignment(list: &[Value], key: &str, unit: &str, value: &str) -> Option<String> {
    list.iter()
        .find(|a| a.get(key).and_then(Value::as_str) == Some(unit))
        .and_then(|a| a.get(value).and_then(Value::as_str))
        .map(str::to_string)
}

fn main() {
    let input = arg("--in", "raw.jsonl");
    let output = arg("--out", "decisions.jsonl");
    let mut out = BufWriter::new(fs::File::create(&output).expect("create output"));
    let mut rows = 0usize;
    let mut unparsed = 0usize;
    let eval_model = arg("--eval-model", "");
    let eval_holdout: u64 = arg("--holdout", "5").parse().unwrap();
    let eval_weights =
        (!eval_model.is_empty()).then(|| fs::read_to_string(&eval_model).expect("model"));
    let mut eval = (0usize, 0usize, 0usize);
    let mut no_view = 0usize;
    let reader: Box<dyn BufRead> = if input == "-" {
        Box::new(BufReader::new(std::io::stdin()))
    } else {
        Box::new(BufReader::new(fs::File::open(&input).expect("open input")))
    };
    for line in reader.lines() {
        let line = line.expect("read line");
        if line.trim().is_empty() {
            continue;
        }
        let raw: Raw = match serde_json::from_str(&line) {
            Ok(raw) => raw,
            Err(_) => {
                unparsed += 1;
                continue;
            }
        };
        let mut bot = SimpleAi::new();
        bot.observe_lazy(raw.view.to_string());
        let view_ok = bot.has_view();
        if !view_ok {
            no_view += 1;
            if no_view == 1 {
                if let Err(error) = serde_json::from_value::<GameViewDto>(raw.view.clone()) {
                    eprintln!("first unparsed view: {error}");
                }
            }
        }
        let (kind, mut units) = bot.prompt_features(&raw.prompt);
        if let PromptInput::ChooseAttackers(attack) = &raw.prompt.input {
            let truth: Vec<AttackAssignment> = attack
                .ai_assignments
                .clone()
                .or_else(|| {
                    raw.output
                        .get("assignments")
                        .and_then(|a| serde_json::from_value(a.clone()).ok())
                })
                .unwrap_or_default();
            if attack.ai_assignments.is_none() && raw.output.get("assignments").is_none() {
                continue;
            }
            units = bot.attack_steps(&raw.prompt, &truth);
            if let Some(weights) = &eval_weights {
                if eval_holdout > 0 && raw.seed.is_multiple_of(eval_holdout) {
                    bot.set_model(weights).expect("model");
                    if let Some((n, model_hits, rule_hits)) =
                        bot.attack_agreement(&raw.prompt, &truth)
                    {
                        eval.0 += n;
                        eval.1 += model_hits;
                        eval.2 += rule_hits;
                    }
                }
            }
        }
        let empty = Vec::new();
        let (forge, mine, key, value): (Vec<Value>, Vec<Value>, &str, &str) =
            match &raw.prompt.input {
                PromptInput::ChooseAction(action) => {
                    let hinted = action.actions.iter().any(|a| a.ai_score.is_some());
                    let chosen = raw
                        .output
                        .get("actionId")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let (pick, chosen) = if hinted {
                        (
                            action
                                .actions
                                .iter()
                                .find(|a| a.ai_score.is_some_and(|s| s > 0))
                                .map(|a| a.id.clone()),
                            chosen,
                        )
                    } else {
                        let rule = match bot.decide(raw.prompt.clone()) {
                            Some(PromptOutput::ChooseAction(ChooseActionOutput::Act {
                                action_id,
                            })) => Some(action_id),
                            _ => None,
                        };
                        (chosen, rule)
                    };
                    let entry = |id: Option<String>| {
                        vec![serde_json::json!({ "unit": Value::Null, "id": id })]
                    };
                    (entry(pick), entry(chosen), "unit", "id")
                }
                PromptInput::ChooseAttackers(attack) => (
                    attack
                        .ai_assignments
                        .as_ref()
                        .map(|a| serde_json::to_value(a).unwrap())
                        .and_then(|v| v.as_array().cloned())
                        .unwrap_or(empty.clone()),
                    raw.output
                        .get("assignments")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                    "attackerId",
                    "targetId",
                ),
                PromptInput::ChooseBlockers(block) => (
                    block
                        .ai_assignments
                        .as_ref()
                        .map(|a| serde_json::to_value(a).unwrap())
                        .and_then(|v| v.as_array().cloned())
                        .unwrap_or_else(|| {
                            raw.output
                                .get("assignments")
                                .and_then(Value::as_array)
                                .cloned()
                                .unwrap_or_default()
                        }),
                    if block.ai_assignments.is_some() {
                        raw.output
                            .get("assignments")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        match bot.decide(raw.prompt.clone()) {
                            Some(PromptOutput::ChooseBlockers(
                                ChooseBlockersOutput::DeclareBlockers { assignments },
                            )) => serde_json::to_value(assignments)
                                .ok()
                                .and_then(|v| v.as_array().cloned())
                                .unwrap_or_default(),
                            _ => Vec::new(),
                        }
                    },
                    "blockerId",
                    "attackerId",
                ),
                _ => continue,
            };
        for unit in units {
            let unit_id = unit.unit.clone().unwrap_or_default();
            let (forge_id, chosen_id) = if key == "unit" {
                (
                    forge[0]
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    mine[0]
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                )
            } else {
                (
                    assignment(&forge, key, &unit_id, value),
                    assignment(&mine, key, &unit_id, value),
                )
            };
            let Some(label) = unit
                .label
                .or_else(|| unit.cands.iter().position(|(id, _)| *id == forge_id))
            else {
                continue;
            };
            let bot_index = if unit.label.is_some() {
                None
            } else {
                unit.cands.iter().position(|(id, _)| *id == chosen_id)
            };
            let names: Vec<String> = unit
                .cands
                .iter()
                .map(|(id, _)| id.clone().unwrap_or_else(|| "none".to_string()))
                .collect();
            let cands: Vec<&Vec<u32>> = unit.cands.iter().map(|(_, f)| f).collect();
            let row = serde_json::json!({
                "kind": kind,
                "seed": raw.seed,
                "seat": raw.seat,
                "turn": raw.turn,
                "step": raw.step,
                "won": raw.won,
                "viewOk": view_ok,
                "reason": raw.reason,
                "unit": unit.unit,
                "label": label,
                "bot": bot_index,
                "names": names,
                "cands": cands,
            });
            writeln!(out, "{row}").unwrap();
            rows += 1;
        }
    }
    println!(
        "wrote {rows} rows to {output}; {unparsed} prompts unparsed, {no_view} views unparsed"
    );
    if eval_weights.is_some() {
        println!(
            "held-out attackers: {} decisions, model {:.3}, rules {:.3}",
            eval.0,
            eval.1 as f32 / eval.0.max(1) as f32,
            eval.2 as f32 / eval.0.max(1) as f32
        );
    }
}
