import type { Prompt } from "@/protocol";

export type WorkbenchDecisionImportance = "routine" | "strategic";

export interface WorkbenchDecisionClassification {
  importance: WorkbenchDecisionImportance;
  reason: string;
}

export function classifyWorkbenchDecision(prompt: Prompt): WorkbenchDecisionClassification {
  switch (prompt.input.type) {
    case "payManaCost":
      return {
        importance: "routine",
        reason: "Mana payment is usually mechanical once the parent action is chosen.",
      };

    case "chooseAction": {
      const actions = prompt.input.actions;
      if (actions.length === 0) {
        return {
          importance: "routine",
          reason: "No legal action is available beyond passing priority.",
        };
      }

      const hasStrategicAction = actions.some(
        (action) =>
          action.type === "cast" ||
          (action.type === "activateAbility" && action.isManaAbility !== true),
      );

      return hasStrategicAction
        ? {
            importance: "strategic",
            reason: "The engine is offering a spell or non-mana activated ability.",
          }
        : {
            importance: "routine",
            reason: "Only mana-management or undo-mana actions are available.",
          };
    }

    case "mulligan":
    case "mulliganPutBack":
      return {
        importance: "strategic",
        reason: "Opening-hand decisions materially change the game plan.",
      };

    case "chooseAttackers":
    case "chooseBlockers":
    case "chooseDamageAssignmentOrder":
    case "chooseCombatDamageAssignment":
      return {
        importance: "strategic",
        reason: "Combat decisions depend on board state, future turns, and opponent incentives.",
      };

    case "chooseBoardTargets":
      return {
        importance: "strategic",
        reason: "Target selection is normally part of the spell or ability's strategic intent.",
      };

    case "chooseColor":
      return {
        importance: "routine",
        reason: "Color production is usually a mechanical follow-up to an already chosen spell or ability.",
      };

    case "reorder":
      return {
        importance: "routine",
        reason: "Most trigger-order prompts are low-impact; GPT-6 Luna low reasoning is sufficient unless the engine later exposes stronger semantic hints.",
      };

    case "chooseBoolean":
    case "chooseFromSelection":
    case "chooseCards":
    case "chooseNumber":
    case "scry":
      return {
        importance: "strategic",
        reason: "The prompt contains a choice that can change future resources or sequencing.",
      };

    default:
      return {
        importance: "routine",
        reason: "This prompt is not a supported strategic Workbench decision.",
      };
  }
}
