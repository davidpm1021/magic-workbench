import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PromptOutput } from "@/protocol";

export type WorkbenchControllerMode = "manual" | "assisted" | "thinking-ai";

export interface WorkbenchRecommendation {
  promptId: number;
  output: PromptOutput["output"];
  label: string;
  reason: string;
  model: string;
  createdAt: number;
}

export type WorkbenchStatusKind = "idle" | "thinking" | "ready" | "paused" | "error";

export interface WorkbenchStatus {
  kind: WorkbenchStatusKind;
  message: string;
}

interface WorkbenchState {
  controllerMode: WorkbenchControllerMode;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  strategyPrompt: string;
  autoYieldTrivial: boolean;
  recommendation: WorkbenchRecommendation | null;
  status: WorkbenchStatus;

  setControllerMode: (mode: WorkbenchControllerMode) => void;
  setAiBaseUrl: (value: string) => void;
  setAiModel: (value: string) => void;
  setAiApiKey: (value: string) => void;
  setStrategyPrompt: (value: string) => void;
  setAutoYieldTrivial: (value: boolean) => void;
  setRecommendation: (value: WorkbenchRecommendation | null) => void;
  setStatus: (status: WorkbenchStatus) => void;
  resetSession: () => void;
}

const defaultBaseUrl = import.meta.env.VITE_WORKBENCH_AI_BASE_URL ?? (import.meta.env.DEV ? "/workbench-ai" : "");
const defaultModel = import.meta.env.VITE_WORKBENCH_AI_MODEL ?? "";

const DEFAULT_STRATEGY =
  "Play to maximize your chance of winning while respecting multiplayer threat assessment. Preserve interaction when a larger threat is likely, sequence mana efficiently, and do not assume hidden information.";

export const useWorkbenchStore = create<WorkbenchState>()(
  devtools(
    (set) => ({
      controllerMode: "manual",
      aiBaseUrl: defaultBaseUrl,
      aiModel: defaultModel,
      aiApiKey: "",
      strategyPrompt: DEFAULT_STRATEGY,
      autoYieldTrivial: true,
      recommendation: null,
      status: {
        kind: "idle",
        message: "Manual control. Workbench is observing the game.",
      },

      setControllerMode: (controllerMode) =>
        set({
          controllerMode,
          recommendation: null,
          status:
            controllerMode === "thinking-ai"
              ? {
                  kind: "paused",
                  message: "Thinking AI takeover is armed and will act on supported prompts.",
                }
              : controllerMode === "assisted"
                ? {
                    kind: "idle",
                    message: "Assisted mode. Ask the AI when you want a recommendation.",
                  }
                : {
                    kind: "idle",
                    message: "Manual control. Workbench is observing the game.",
                  },
        }),
      setAiBaseUrl: (aiBaseUrl) => set({ aiBaseUrl }),
      setAiModel: (aiModel) => set({ aiModel }),
      setAiApiKey: (aiApiKey) => set({ aiApiKey }),
      setStrategyPrompt: (strategyPrompt) => set({ strategyPrompt }),
      setAutoYieldTrivial: (autoYieldTrivial) => set({ autoYieldTrivial }),
      setRecommendation: (recommendation) => set({ recommendation }),
      setStatus: (status) => set({ status }),
      resetSession: () =>
        set({
          controllerMode: "manual",
          aiApiKey: "",
          recommendation: null,
          status: {
            kind: "idle",
            message: "Manual control. Workbench is observing the game.",
          },
        }),
    }),
    { name: "workbench", enabled: import.meta.env.DEV },
  ),
);
