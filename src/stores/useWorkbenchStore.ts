import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PromptOutput } from "@/protocol";
import type { WorkbenchTokenUsage } from "@/workbench/pricing";
import {
  buildWorkbenchGameTelemetry,
  telemetrySnapshotFingerprint,
  type WorkbenchGameTelemetry,
  type WorkbenchTelemetrySnapshot,
} from "@/workbench/deckTelemetry";

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
  outcomeScope?: "prompt" | "transaction" | null;
  manaPlan?: string[];
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
  manaPlan?: string[];
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

export type WorkbenchDeckTestStatus = "idle" | "running" | "completed" | "stopped" | "error";

export interface WorkbenchBenchmarkOpponent {
  id: string;
  name: string;
  sourceUrl: string;
  archetype: string;
  bracket?: number;
}

export interface WorkbenchDeckTestSession {
  status: WorkbenchDeckTestStatus;
  targetGames: number;
  startedAt: number | null;
  reports: WorkbenchGameTelemetry[];
  error: string | null;
  benchmarkOpponents?: WorkbenchBenchmarkOpponent[];
  benchmarkGameIndex?: number;
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
  telemetrySnapshots: Record<string, WorkbenchTelemetrySnapshot[]>;
  gameTelemetry: WorkbenchGameTelemetry[];
  deckTestSession: WorkbenchDeckTestSession;
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
  recordTelemetrySnapshot: (snapshot: WorkbenchTelemetrySnapshot) => void;
  completeGame: (gameId: string, winnerId: string | null, turn: number) => void;
  clearCompletedGame: () => void;
  startDeckTest: (targetGames: number, benchmarkOpponents?: WorkbenchBenchmarkOpponent[]) => void;
  advanceBenchmarkOpponent: () => void;
  stopDeckTest: () => void;
  failDeckTest: (message: string) => void;
  clearDeckTest: () => void;
  setStatus: (status: WorkbenchStatus) => void;
  resetSession: () => void;
}

const defaultBaseUrl = import.meta.env.VITE_WORKBENCH_AI_BASE_URL ?? (import.meta.env.DEV ? "/workbench-ai" : "");
const defaultModel = import.meta.env.VITE_WORKBENCH_AI_MODEL ?? "";
const defaultFastModel = import.meta.env.VITE_WORKBENCH_AI_FAST_MODEL ?? "";

const DEFAULT_STRATEGY =
  "Play to maximize your chance of winning while respecting multiplayer threat assessment. Preserve interaction when a larger threat is likely, sequence mana efficiently, and do not assume hidden information.";

const DECK_TEST_STORAGE_KEY = "magic-workbench-deck-test-v1";
const WORKBENCH_CONFIG_STORAGE_KEY = "magic-workbench-config-v1";

interface PersistedWorkbenchConfig {
  aiBaseUrl: string;
  aiModel: string;
  aiFastModel: string;
  strategyPrompt: string;
  autoYieldTrivial: boolean;
  gameBudgetUsd: number;
}

function loadWorkbenchConfig(): Partial<PersistedWorkbenchConfig> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(WORKBENCH_CONFIG_STORAGE_KEY) ?? "{}") as Partial<PersistedWorkbenchConfig>;
  } catch {
    return {};
  }
}

function saveWorkbenchConfig(patch: Partial<PersistedWorkbenchConfig>): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadWorkbenchConfig();
    window.localStorage.setItem(WORKBENCH_CONFIG_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    return;
  }
}

const savedWorkbenchConfig = loadWorkbenchConfig();

function emptyDeckTestSession(): WorkbenchDeckTestSession {
  return {
    status: "idle",
    targetGames: 10,
    startedAt: null,
    reports: [],
    error: null,
  };
}

function loadDeckTestSession(): WorkbenchDeckTestSession {
  if (typeof window === "undefined") return emptyDeckTestSession();
  try {
    const raw = window.localStorage.getItem(DECK_TEST_STORAGE_KEY);
    if (!raw) return emptyDeckTestSession();
    const parsed = JSON.parse(raw) as Partial<WorkbenchDeckTestSession>;
    const reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    const targetGames =
      typeof parsed.targetGames === "number" && Number.isFinite(parsed.targetGames)
        ? Math.max(1, Math.min(1000, Math.round(parsed.targetGames)))
        : 10;
    return {
      status:
        parsed.status === "completed" || parsed.status === "stopped" || parsed.status === "error"
          ? parsed.status
          : reports.length > 0
            ? "stopped"
            : "idle",
      targetGames,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      reports,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return emptyDeckTestSession();
  }
}

function saveDeckTestSession(session: WorkbenchDeckTestSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DECK_TEST_STORAGE_KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

function clearSavedDeckTestSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DECK_TEST_STORAGE_KEY);
  } catch {
    return;
  }
}

export const useWorkbenchStore = create<WorkbenchState>()(
  devtools(
    (set) => ({
      controllerMode: "manual",
      aiBaseUrl: savedWorkbenchConfig.aiBaseUrl ?? defaultBaseUrl,
      aiModel: savedWorkbenchConfig.aiModel ?? defaultModel,
      aiFastModel: savedWorkbenchConfig.aiFastModel ?? defaultFastModel,
      aiApiKey: "",
      strategyPrompt: savedWorkbenchConfig.strategyPrompt ?? DEFAULT_STRATEGY,
      autoYieldTrivial: savedWorkbenchConfig.autoYieldTrivial ?? true,
      gameBudgetUsd: savedWorkbenchConfig.gameBudgetUsd ?? 10,
      recommendation: null,
      history: [],
      auditLog: [],
      recovery: null,
      retryGeneration: 0,
      lastCompletedGame: null,
      telemetrySnapshots: {},
      gameTelemetry: [],
      deckTestSession: loadDeckTestSession(),
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
      setAiBaseUrl: (aiBaseUrl) => { saveWorkbenchConfig({ aiBaseUrl }); set({ aiBaseUrl }); },
      setAiModel: (aiModel) => { saveWorkbenchConfig({ aiModel }); set({ aiModel }); },
      setAiFastModel: (aiFastModel) => { saveWorkbenchConfig({ aiFastModel }); set({ aiFastModel }); },
      setAiApiKey: (aiApiKey) => set({ aiApiKey }),
      setStrategyPrompt: (strategyPrompt) => { saveWorkbenchConfig({ strategyPrompt }); set({ strategyPrompt }); },
      setAutoYieldTrivial: (autoYieldTrivial) => { saveWorkbenchConfig({ autoYieldTrivial }); set({ autoYieldTrivial }); },
      setGameBudgetUsd: (gameBudgetUsd) => {
        const value = Math.max(0, gameBudgetUsd);
        saveWorkbenchConfig({ gameBudgetUsd: value });
        set({ gameBudgetUsd: value });
      },
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
      recordTelemetrySnapshot: (snapshot) =>
        set((state) => {
          const previous = state.telemetrySnapshots[snapshot.gameId] ?? [];
          const last = previous.at(-1);
          if (
            last &&
            telemetrySnapshotFingerprint(last) === telemetrySnapshotFingerprint(snapshot)
          ) {
            return state;
          }
          return {
            telemetrySnapshots: {
              ...state.telemetrySnapshots,
              [snapshot.gameId]: [...previous.slice(-1499), snapshot],
            },
          };
        }),
      completeGame: (gameId, winnerId, turn) =>
        set((state) => {
          const entries = state.auditLog.filter((entry) => entry.gameId === gameId);
          const existingReport = state.gameTelemetry.find((report) => report.gameId === gameId);
          const baseReport =
            existingReport ??
            buildWorkbenchGameTelemetry({
              gameId,
              winnerId,
              turn,
              snapshots: state.telemetrySnapshots[gameId] ?? [],
              auditEntries: entries,
            });
          const suite = state.deckTestSession.benchmarkOpponents ?? [];
          const benchmarkOpponent =
            state.deckTestSession.status === "running" && suite.length > 0
              ? suite[state.deckTestSession.reports.length % suite.length]
              : undefined;
          const report = benchmarkOpponent
            ? { ...baseReport, benchmarkOpponent }
            : baseReport;
          const nextSnapshots = { ...state.telemetrySnapshots };
          delete nextSnapshots[gameId];

          const alreadyInDeckTest = state.deckTestSession.reports.some(
            (item) => item.gameId === gameId,
          );
          const shouldAddToDeckTest =
            state.deckTestSession.status === "running" && !alreadyInDeckTest;
          const nextReports = shouldAddToDeckTest
            ? [...state.deckTestSession.reports, report]
            : state.deckTestSession.reports;
          const deckTestComplete =
            state.deckTestSession.status === "running" &&
            nextReports.length >= state.deckTestSession.targetGames;

          const nextDeckTestSession = shouldAddToDeckTest
            ? {
                ...state.deckTestSession,
                status: deckTestComplete ? ("completed" as const) : ("running" as const),
                reports: nextReports,
                error: null,
              }
            : state.deckTestSession;
          if (shouldAddToDeckTest) saveDeckTestSession(nextDeckTestSession);

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
            telemetrySnapshots: nextSnapshots,
            gameTelemetry: existingReport
              ? state.gameTelemetry
              : [...state.gameTelemetry.slice(-99), report],
            deckTestSession: nextDeckTestSession,
          };
        }),
      clearCompletedGame: () => set({ lastCompletedGame: null }),
      startDeckTest: (targetGames) =>
        set(() => {
          const deckTestSession: WorkbenchDeckTestSession = {
            status: "running",
            targetGames: Math.max(1, Math.min(1000, Math.round(targetGames))),
            startedAt: Date.now(),
            reports: [],
            error: null,
            benchmarkOpponents: [],
            benchmarkGameIndex: 0,
          };
          saveDeckTestSession(deckTestSession);
          return { deckTestSession };
        }),
      advanceBenchmarkOpponent: () =>
        set((state) => {
          const deckTestSession = {
            ...state.deckTestSession,
            benchmarkGameIndex: (state.deckTestSession.benchmarkGameIndex ?? 0) + 1,
          };
          saveDeckTestSession(deckTestSession);
          return { deckTestSession };
        }),
      stopDeckTest: () =>
        set((state) => {
          const deckTestSession: WorkbenchDeckTestSession = {
            ...state.deckTestSession,
            status: state.deckTestSession.reports.length > 0 ? "stopped" : "idle",
          };
          saveDeckTestSession(deckTestSession);
          return { deckTestSession };
        }),
      failDeckTest: (message) =>
        set((state) => {
          const deckTestSession: WorkbenchDeckTestSession = {
            ...state.deckTestSession,
            status: "error",
            error: message,
          };
          saveDeckTestSession(deckTestSession);
          return { deckTestSession };
        }),
      clearDeckTest: () =>
        set(() => {
          clearSavedDeckTestSession();
          return { deckTestSession: emptyDeckTestSession() };
        }),
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
