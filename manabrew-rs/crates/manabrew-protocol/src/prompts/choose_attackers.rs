use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::prompts::common::{AttackAssignment, AttackTargetDto};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub struct AttackerOptionDto {
    pub attacker_id: String,
    pub valid_target_ids: Vec<String>,
    pub must_attack: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub struct ChooseAttackersInput {
    pub attackers: Vec<AttackerOptionDto>,
    pub attack_targets: Vec<AttackTargetDto>,
    // Diagnostic, only when the host asked the engine for its own AI's opinion
    // on the seat: the attack Forge's AI would declare now, empty when it
    // would not attack.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ai_assignments: Option<Vec<AttackAssignment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "prompts/chooseAttackers.ts")]
pub enum ChooseAttackersOutput {
    DeclareAttackers { assignments: Vec<AttackAssignment> },
}
