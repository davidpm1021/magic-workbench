import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PromptOutput } from "@/protocol";
import type { WorkbenchTokenUsage } from "@/workbench/pricing";

export type WorkbenchControllerMode = "manual" | "assisted" | "thinking-ai";
export type WorkbenchYieldUntil = "none" | "material_state_change";

export interface WorkbenchAuditEntry {
  id: string;
  gameId: string;
  createdAt: number;
  source: "ai" | "deterministic" | "human";
  status: "success" | "error" | "deterministic" | "manual";
  promptId: number;
  promptType: string;
  importance: "routine" | "strategic" | "deterministic" | "manual";
  model: string | null;
  latencyMs: number | null;
  usage: WorkbenchTokenUsage | null;
  estimatedCostUsd: number | null;
  reason: string | null;
  output: PromptOutput["output"] | null;
  error: string | null;
  responseStatus: string | null;
  incompleteReason: string | null;
  rawModelText: string | null;
  promptSnapshot: unknown;
  visibleGameState: unknown;
  yieldUntil?: WorkbenchYieldUntil;
  outcomeDelta?: string[] | null;
  outcomeRecordedAt?: number | null;
}

export interface WorkbenchRecommendation {
  promptId: number;
  output: PromptOutput["output"];
  label: string;
  reason: string;
  model: string;
  promptType: string;
  importance: "routine" | "strategic";
  latencyMs: number;
  gameId: string;
  usage: WorkbenchTokenUsage | null;
  estimatedCostUsd: number | null;
  promptFingerprint: string;
  createdAt: number;
  yieldUntil?: WorkbenchYieldUntil;
  materialStateFingerprint?: string;
  auditId?: string;
}

export type WorkbenchStatusKind = "idle" | "thinking" | "ready" | "paused" | "error";

export interface WorkbenchStatus {
  kind: WorkbenchStatusKind;
  message: string;
}

export interface WorkbenchRecoveryState {
  promptId: number;
  promptType: string;
  error: string;
  mode: "error" | "manual";
}

export interface WorkbenchCompletedGame {
  gameId: string;
  completedAt: number;
  winnerId: string | null;
  turn: number;
  entries: number;
  paidAiCalls: number;
  errors: number;
  estimatedCostUsd: number;
}

interface WorkbenchState {
  controllerMode: WorkbenchControllerMode;
  aiBaseUrl: string;
  aiModel: string;
  aiFastModel: string;
  aiApiKey: string;
  strategyPrompt: string;
  autoYieldTrivial: boolean;
  gameBudgetUsd: number;
  recommendation: WorkbenchRecommendation | null;
  history: WorkbenchRecommendation[];
  auditLog: WorkbenchAuditEntry[];
  recovery: WorkbenchRecoveryState | null;
  retryGeneration: number;
  lastCompletedGame: WorkbenchCompletedGame | null;
  status: WorkbenchStatus;

  setControllerMode: (mode: WorkbenchControllerMode) => void;
  setAiBaseUrl: (value: string) => void;
  setAiModel: (value: string) => void;
  setAiFastModel: (value: string) => void;
  setAiApiKey: (value: string) => void;
  setStrategyPrompt: (value: string) => void;
  setAutoYieldTrivial: (value: boolean) => void;
  setGameBudgetUsd: (value: number) => void;
  setRecommendation: (value: WorkbenchRecommendation | null) => void;
  clearHistory: () => void;
  addAuditEntry: (entry: WorkbenchAuditEntry) => void;
  updateAuditEntry: (id: string, patch: Partial<WorkbenchAuditEntry>) => void;
  clearAuditLog: () => void;
  setRecovery: (recovery: WorkbenchRecoveryState | null) => void;
  retryRecovery: () => void;
  resolveRecoveryManually: () => void;
  clearRecovery: () => void;
  completeGame: (gameId: string, winnerId: string | null, turn: number) => void;
  clearCompletedGame: () => void;
  setStatus: (status: WorkbenchStatus) => void;
  resetSession: () => void;
}

const defaultBaseUrl = import.meta.env.VITE_WORKBENCH_AI_BASE_URL ?? (import.meta.env.DEV ? "/workbench-ai" : "");
const defaultModel = import.meta.env.VITE_WORKBENCH_AI_MODEL ?? "";
const defaultFastModel = import.meta.env.VITE_WORKBENCH_AI_FAST_MODEL ?? "";

const DEFAULT_STRATEGY =
  "Play to maximize your chance of winning while respecting multiplayer threat assessment. Preserve interaction when a larger threat is likely, sequence mana efficiently, and do not assume hidden information.";

export const useWorkbenchStore = create<WorkbenchState>()(
  devtools(
    (set) => ({
      controllerMode: "manual",
      aiBaseUrl: defaultBaseUrl,
      aiModel: defaultModel,
      aiFastModel: defaultFastModel,
      aiApiKey: "",
      strategyPrompt: DEFAULT_STRATEGY,
      autoYieldTrivial: true,
      gameBudgetUsd: 0.5,
      recommendation: null,
      history: [],
      auditLog: [],
      recovery: null,
      retryGeneration: 0,
      lastCompletedGame: null,
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
      setAiFastModel: (aiFastModel) => set({ aiFastModel }),
      setAiApiKey: (aiApiKey) => set({ aiApiKey }),
      setStrategyPrompt: (strategyPrompt) => set({ strategyPrompt }),
      setAutoYieldTrivial: (autoYieldTrivial) => set({ autoYieldTrivial }),
      setGameBudgetUsd: (gameBudgetUsd) => set({ gameBudgetUsd: Math.max(0, gameBudgetUsd) }),
      setRecommendation: (recommendation) =>
        set((state) => ({
          recommendation,
          history: recommendation
            ? [...state.history.slice(-999), recommendation]
            : state.history,
        })),
      clearHistory: () => set({ history: [] }),
      addAuditEntry: (entry) =>
        set((state) => ({
          auditLog: [...state.auditLog.slice(-1999), entry],
        })),
      updateAuditEntry: (id, patch) =>
        set((state) => ({
          auditLog: state.auditLog.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry,
          ),
        })),
      clearAuditLog: () => set({ auditLog: [] }),
      setRecovery: (recovery) => set({ recovery }),
      retryRecovery: () =>
        set((state) => ({
          recovery: null,
          retryGeneration: state.retryGeneration + 1,
          status: {
            kind: "paused",
            message: "Retrying AI on the current prompt...",
          },
        })),
      resolveRecoveryManually: () =>
        set((state) => ({
          recovery: state.recovery ? { ...state.recovery, mode: "manual" } : null,
          status: {
            kind: "paused",
            message:
              "Manual recovery active for this decision. Thinking AI will resume automatically after the prompt advances.",
          },
        })),
      clearRecovery: () => set({ recovery: null }),
      completeGame: (gameId, winnerId, turn) =>
        set((state) => {
          const entries = state.auditLog.filter((entry) => entry.gameId === gameId);
          return {
            lastCompletedGame: {
              gameId,
              completedAt: Date.now(),
              winnerId,
              turn,
              entries: entries.length,
              paidAiCalls: entries.filter((entry) => entry.source === "ai").length,
              errors: entries.filter((entry) => entry.status === "error").length,
              estimatedCostUsd: entries.reduce(
                (sum, entry) => sum + (entry.estimatedCostUsd ?? 0),
                0,
              ),
            },
          };
        }),
      clearCompletedGame: () => set({ lastCompletedGame: null }),
      setStatus: (status) => set({ status }),
      resetSession: () =>
        set({
          controllerMode: "manual",
          aiApiKey: "",
          recommendation: null,
          recovery: null,
          retryGeneration: 0,
          status: {
            kind: "idle",
            message: "Manual control. Workbench is observing the game.",
          },
        }),
    }),
    { name: "workbench", enabled: import.meta.env.DEV },
  ),
);
