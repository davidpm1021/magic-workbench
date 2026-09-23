import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { resolvePrompt } from "@/components/prompts/internal/promptHandlers";
import { classifyWorkbenchDecision } from "./decisionImportance";
import { compactWorkbenchGameView } from "./compactGameView";
import {
  buildWorkbenchDecisionContext,
  chooseActionHasOnlyManaManagement,
  chooseDeterministicManaStep,
} from "./controllerPolicy";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  isWorkbenchAiPrompt,
  requestWorkbenchDecision,
} from "./aiDecision";

export function useWorkbenchController(paused = false): void {
  const currentPrompt = useGameStore((state) => state.currentPrompt);
  const liveGameView = useGameStore((state) => state.gameView);
  const isWaitingForResponse = useGameStore((state) => state.isWaitingForResponse);
  const respond = useGameStore((state) => state.respond);
  const showOverrides = usePromptPreferencesStore((state) => state.show);

  const controllerMode = useWorkbenchStore((state) => state.controllerMode);
  const aiBaseUrl = useWorkbenchStore((state) => state.aiBaseUrl);
  const aiModel = useWorkbenchStore((state) => state.aiModel);
  const aiFastModel = useWorkbenchStore((state) => state.aiFastModel);
  const aiApiKey = useWorkbenchStore((state) => state.aiApiKey);
  const strategyPrompt = useWorkbenchStore((state) => state.strategyPrompt);
  const autoYieldTrivial = useWorkbenchStore((state) => state.autoYieldTrivial);
  const gameBudgetUsd = useWorkbenchStore((state) => state.gameBudgetUsd);
  const setRecommendation = useWorkbenchStore((state) => state.setRecommendation);
  const addAuditEntry = useWorkbenchStore((state) => state.addAuditEntry);
  const recovery = useWorkbenchStore((state) => state.recovery);
  const retryGeneration = useWorkbenchStore((state) => state.retryGeneration);
  const setRecovery = useWorkbenchStore((state) => state.setRecovery);
  const clearRecovery = useWorkbenchStore((state) => state.clearRecovery);
  const completeGame = useWorkbenchStore((state) => state.completeGame);
  const setStatus = useWorkbenchStore((state) => state.setStatus);

  const inFlightPromptRef = useRef<number | null>(null);

  useEffect(() => {
    if (!liveGameView?.gameOver) return;
    const workbench = useWorkbenchStore.getState();
    const alreadyLoggedTerminal = workbench.auditLog.some(
      (entry) => entry.gameId === liveGameView.gameId && entry.promptType === "gameOver",
    );
    if (!alreadyLoggedTerminal) {
      addAuditEntry({
        id: `det-${Date.now()}-game-over`,
        gameId: liveGameView.gameId,
        createdAt: Date.now(),
        source: "deterministic",
        status: "deterministic",
        promptId: 0,
        promptType: "gameOver",
        importance: "deterministic",
        model: null,
        latencyMs: 0,
        usage: null,
        estimatedCostUsd: 0,
        reason: `Game over. Winner: ${liveGameView.winnerId ?? "none recorded"}.`,
        output: null,
        error: null,
        responseStatus: null,
        incompleteReason: null,
        rawModelText: null,
        promptSnapshot: null,
        visibleGameState: compactWorkbenchGameView(liveGameView),
      });
    }
    completeGame(liveGameView.gameId, liveGameView.winnerId ?? null, liveGameView.turn);
  }, [liveGameView, addAuditEntry, completeGame]);

  useEffect(() => {
    if (!recovery) return;
    if (isWaitingForResponse) return;
    const currentPromptId = Number(currentPrompt?.promptId ?? 0);
    if (currentPrompt && currentPromptId === recovery.promptId) return;

    clearRecovery();
    if (controllerMode === "thinking-ai") {
      setStatus({
        kind: "paused",
        message: "Manual recovery completed. Thinking AI takeover resumed.",
      });
    }
  }, [
    recovery,
    currentPrompt,
    isWaitingForResponse,
    controllerMode,
    clearRecovery,
    setStatus,
  ]);

  useEffect(() => {
    if (paused || !autoYieldTrivial || isWaitingForResponse) return;
    if (recovery?.mode === "manual" && Number(currentPrompt?.promptId ?? 0) === recovery.promptId) return;
    if (currentPrompt?.input.type !== "chooseAction") return;
    if (currentPrompt.input.actions.length !== 0) return;

    const gameView = useGameStore.getState().gameView;
    if (gameView) {
      addAuditEntry({
        id: `det-${Date.now()}-${currentPrompt.promptId ?? 0}`,
        gameId: gameView.gameId,
        createdAt: Date.now(),
        source: "deterministic",
        status: "deterministic",
        promptId: Number(currentPrompt.promptId ?? 0),
        promptType: currentPrompt.input.type,
        importance: "deterministic",
        model: null,
        latencyMs: 0,
        usage: null,
        estimatedCostUsd: 0,
        reason: "No legal action was available beyond passing priority.",
        output: { type: "pass", exhaustStack: false },
        error: null,
        responseStatus: null,
        incompleteReason: null,
        rawModelText: null,
        promptSnapshot: currentPrompt,
        visibleGameState: compactWorkbenchGameView(gameView),
      });
    }
    setStatus({
      kind: "idle",
      message: "Auto-yielded priority because the engine exposed no legal actions.",
    });
    void respond({ type: "pass", exhaustStack: false });
  }, [
    paused,
    autoYieldTrivial,
    currentPrompt,
    isWaitingForResponse,
    respond,
    setStatus,
    showOverrides,
    addAuditEntry,
    recovery,
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai" || isWaitingForResponse) return;
    if (!currentPrompt || currentPrompt.input.type !== "chooseAction") return;
    if (recovery?.mode === "manual" && Number(currentPrompt.promptId ?? 0) === recovery.promptId) return;
    if (!chooseActionHasOnlyManaManagement(currentPrompt)) return;

    const gameView = useGameStore.getState().gameView;
    if (!gameView || gameView.stack.length > 0) return;

    addAuditEntry({
      id: `det-${Date.now()}-${currentPrompt.promptId ?? 0}`,
      gameId: gameView.gameId,
      createdAt: Date.now(),
      source: "deterministic",
      status: "deterministic",
      promptId: Number(currentPrompt.promptId ?? 0),
      promptType: currentPrompt.input.type,
      importance: "deterministic",
      model: null,
      latencyMs: 0,
      usage: null,
      estimatedCostUsd: 0,
      reason:
        "Only ordinary mana-management actions were exposed during an empty-stack priority window; Workbench preserved mana and passed instead of asking the model to float it.",
      output: { type: "pass", exhaustStack: false },
      error: null,
      responseStatus: null,
      incompleteReason: null,
      rawModelText: null,
      promptSnapshot: currentPrompt,
      visibleGameState: compactWorkbenchGameView(gameView),
    });
    setStatus({
      kind: "idle",
      message: "Skipped routine mana-floating priority. No AI call needed.",
    });
    void respond({ type: "pass", exhaustStack: false });
  }, [
    paused,
    controllerMode,
    currentPrompt,
    isWaitingForResponse,
    respond,
    setStatus,
    addAuditEntry,
    recovery,
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai" || isWaitingForResponse) return;
    if (!currentPrompt) return;
    if (recovery?.mode === "manual" && Number(currentPrompt.promptId ?? 0) === recovery.promptId) return;
    if (currentPrompt.input.type !== "revealCards" && currentPrompt.input.type !== "diceRolled") {
      return;
    }

    const gameView = useGameStore.getState().gameView;
    const output =
      currentPrompt.input.type === "revealCards"
        ? ({ type: "revealCardsAcknowledged" } as const)
        : ({ type: "diceRolledAcknowledged" } as const);
    if (gameView) {
      addAuditEntry({
        id: `det-${Date.now()}-${currentPrompt.promptId ?? 0}`,
        gameId: gameView.gameId,
        createdAt: Date.now(),
        source: "deterministic",
        status: "deterministic",
        promptId: Number(currentPrompt.promptId ?? 0),
        promptType: currentPrompt.input.type,
        importance: "deterministic",
        model: null,
        latencyMs: 0,
        usage: null,
        estimatedCostUsd: 0,
        reason: "Informational prompt acknowledged automatically; no strategic choice was required.",
        output,
        error: null,
        responseStatus: null,
        incompleteReason: null,
        rawModelText: null,
        promptSnapshot: currentPrompt,
        visibleGameState: compactWorkbenchGameView(gameView),
      });
    }
    setStatus({
      kind: "idle",
      message: "Acknowledged informational prompt automatically. No AI call needed.",
    });
    void respond(output);
  }, [
    paused,
    controllerMode,
    currentPrompt,
    isWaitingForResponse,
    respond,
    setStatus,
    addAuditEntry,
    recovery,
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai" || isWaitingForResponse) return;
    if (recovery?.mode === "manual" && Number(currentPrompt?.promptId ?? 0) === recovery.promptId) return;
    if (currentPrompt?.input.type !== "payManaCost") return;

    const state = useGameStore.getState();
    const gameView = state.gameView;
    if (!gameView) return;

    const output = currentPrompt.input.canConfirmFromPool
      ? ({ type: "pay", auto: false } as const)
      : chooseDeterministicManaStep(currentPrompt, gameView, state.myPlayerSlot);
    if (!output) return;

    const reason =
      output.type === "pay"
        ? "The engine reported the mana pool already satisfied the cost."
        : "A fixed mana source unambiguously satisfied the next simple mana requirement.";

    addAuditEntry({
      id: `det-${Date.now()}-${currentPrompt.promptId ?? 0}`,
      gameId: gameView.gameId,
      createdAt: Date.now(),
      source: "deterministic",
      status: "deterministic",
      promptId: Number(currentPrompt.promptId ?? 0),
      promptType: currentPrompt.input.type,
      importance: "deterministic",
      model: null,
      latencyMs: 0,
      usage: null,
      estimatedCostUsd: 0,
      reason,
      output,
      error: null,
      responseStatus: null,
      incompleteReason: null,
      rawModelText: null,
      promptSnapshot: currentPrompt,
      visibleGameState: compactWorkbenchGameView(gameView),
    });
    setStatus({
      kind: "idle",
      message:
        output.type === "pay"
          ? "Confirmed mana payment deterministically."
          : "Paid the next fixed mana step deterministically. No AI call needed.",
    });
    void respond(output);
  }, [
    paused,
    controllerMode,
    currentPrompt,
    isWaitingForResponse,
    respond,
    setStatus,
    addAuditEntry,
    recovery,
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai") return;
    if (!currentPrompt || isWaitingForResponse) return;
    const currentPromptId = Number(currentPrompt.promptId ?? 0);
    if (recovery && recovery.promptId === currentPromptId) return;
    if (autoYieldTrivial && currentPrompt.input.type === "chooseAction" && currentPrompt.input.actions.length === 0) return;
    const preflightState = useGameStore.getState();
    if (
      currentPrompt.input.type === "chooseAction" &&
      chooseActionHasOnlyManaManagement(currentPrompt) &&
      (preflightState.gameView?.stack.length ?? 0) === 0
    ) {
      return;
    }
    if (currentPrompt.input.type === "payManaCost") {
      if (currentPrompt.input.canConfirmFromPool) return;
      if (
        preflightState.gameView &&
        chooseDeterministicManaStep(currentPrompt, preflightState.gameView, preflightState.myPlayerSlot)
      ) {
        return;
      }
    }
    if (currentPrompt.input.type === "revealCards" || currentPrompt.input.type === "diceRolled") return;

    const deterministic = resolvePrompt(currentPrompt, { prefs: { show: showOverrides } });
    if (deterministic.kind === "auto") return;

    if (!isWorkbenchAiPrompt(currentPrompt)) {
      setStatus({
        kind: "paused",
        message: `AI takeover paused for ${currentPrompt.input.type}. Take this decision manually.`,
      });
      return;
    }

    if (!aiBaseUrl.trim() || !aiModel.trim()) {
      setStatus({
        kind: "error",
        message: "AI takeover needs an API base URL and model.",
      });
      return;
    }

    const classification = classifyWorkbenchDecision(currentPrompt);
    const selectedModel =
      classification.importance === "routine" && aiFastModel.trim()
        ? aiFastModel.trim()
        : aiModel.trim();

    const promptId = currentPromptId;
    if (inFlightPromptRef.current === promptId) return;
    inFlightPromptRef.current = promptId;
    const controller = new AbortController();
    const state = useGameStore.getState();
    const gameView = state.gameView;

    if (!gameView) {
      inFlightPromptRef.current = null;
      return;
    }

    const workbenchState = useWorkbenchStore.getState();
    const gameSpend = workbenchState.auditLog
      .filter((item) => item.gameId === gameView.gameId && item.source === "ai")
      .reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0);
    if (gameBudgetUsd > 0 && gameSpend >= gameBudgetUsd) {
      inFlightPromptRef.current = null;
      setStatus({
        kind: "paused",
        message: `AI budget reached (${gameSpend.toFixed(2)} / ${gameBudgetUsd.toFixed(2)}). Raise the cap or take over manually.`,
      });
      return;
    }

    const decisionContext = buildWorkbenchDecisionContext({
      auditLog: useWorkbenchStore.getState().auditLog,
      gameView,
      gameLog: state.gameLog,
      currentPrompt,
    });
    const modeSource = decisionContext.selectionCostHints?.sourceCard;
    if (
      currentPrompt.input.type === "chooseFromSelection" &&
      modeSource &&
      decisionContext.recentFailedPayments.filter((failure) => failure.card === modeSource).length >= 2
    ) {
      inFlightPromptRef.current = null;
      const message =
        `Transaction loop guard: mana payment for ${modeSource} already failed twice this turn. ` +
        "Choose a cheaper mode manually or retry AI after resources change.";
      setRecovery({
        promptId,
        promptType: currentPrompt.input.type,
        error: message,
        mode: "error",
      });
      setStatus({ kind: "error", message });
      return;
    }

    setStatus({
      kind: "thinking",
      message: `${selectedModel} is handling a ${classification.importance} decision...`,
    });

    void requestWorkbenchDecision({
      baseUrl: aiBaseUrl,
      model: selectedModel,
      apiKey: aiApiKey,
      strategyPrompt,
      gameView,
      prompt: currentPrompt,
      myPlayerSlot: state.myPlayerSlot,
      decisionContext,
      signal: controller.signal,
      onAuditEntry: addAuditEntry,
    })
      .then(async (recommendation) => {
        const latestGame = useGameStore.getState();
        const latestWorkbench = useWorkbenchStore.getState();
        if (
          latestWorkbench.controllerMode !== "thinking-ai" ||
          Number(latestGame.currentPrompt?.promptId ?? 0) !== promptId
        ) {
          return;
        }

        const recentSame = latestWorkbench.history
          .slice(-3)
          .reverse()
          .filter(
            (item) =>
              item.gameId === recommendation.gameId &&
              item.promptFingerprint === recommendation.promptFingerprint &&
              JSON.stringify(item.output) === JSON.stringify(recommendation.output),
          ).length;

        clearRecovery();
        setRecommendation(recommendation);

        if (recentSame >= 2) {
          latestWorkbench.setControllerMode("assisted");
          setStatus({
            kind: "paused",
            message:
              "Loop guard stopped AI takeover after the same decision repeated three times. Review this prompt manually.",
          });
          return;
        }

        setStatus({
          kind: "ready",
          message: recommendation.reason,
        });
        await respond(recommendation.output);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setRecovery({
          promptId,
          promptType: currentPrompt.input.type,
          error: message,
          mode: "error",
        });
        setStatus({
          kind: "error",
          message: `${message} AI takeover is paused on this decision.`,
        });
      })
      .finally(() => {
        if (inFlightPromptRef.current === promptId) inFlightPromptRef.current = null;
      });

    return () => controller.abort();
  }, [
    paused,
    controllerMode,
    currentPrompt,
    isWaitingForResponse,
    aiBaseUrl,
    aiModel,
    aiFastModel,
    aiApiKey,
    strategyPrompt,
    autoYieldTrivial,
    gameBudgetUsd,
    respond,
    setRecommendation,
    setStatus,
    showOverrides,
    addAuditEntry,
    recovery,
    retryGeneration,
    setRecovery,
    clearRecovery,
  ]);
}
