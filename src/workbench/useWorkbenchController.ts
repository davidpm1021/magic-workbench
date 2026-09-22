import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { resolvePrompt } from "@/components/prompts/internal/promptHandlers";
import { classifyWorkbenchDecision } from "./decisionImportance";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  isWorkbenchAiPrompt,
  requestWorkbenchDecision,
} from "./aiDecision";

export function useWorkbenchController(paused = false): void {
  const currentPrompt = useGameStore((state) => state.currentPrompt);
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
  const setStatus = useWorkbenchStore((state) => state.setStatus);

  const inFlightPromptRef = useRef<number | null>(null);

  useEffect(() => {
    if (paused || !autoYieldTrivial || isWaitingForResponse) return;
    if (currentPrompt?.input.type !== "chooseAction") return;
    if (currentPrompt.input.actions.length !== 0) return;

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
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai" || isWaitingForResponse) return;
    if (currentPrompt?.input.type !== "payManaCost") return;
    if (!currentPrompt.input.canConfirmFromPool) return;

    setStatus({
      kind: "idle",
      message: "Confirmed mana payment deterministically because the pool satisfies the cost.",
    });
    void respond({ type: "pay", auto: false });
  }, [
    paused,
    controllerMode,
    currentPrompt,
    isWaitingForResponse,
    respond,
    setStatus,
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai") return;
    if (!currentPrompt || isWaitingForResponse) return;
    if (autoYieldTrivial && currentPrompt.input.type === "chooseAction" && currentPrompt.input.actions.length === 0) return;
    if (currentPrompt.input.type === "payManaCost" && currentPrompt.input.canConfirmFromPool) return;

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

    const promptId = Number(currentPrompt.promptId ?? 0);
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
    const gameSpend = workbenchState.history
      .filter((item) => item.gameId === gameView.gameId)
      .reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0);
    if (gameBudgetUsd > 0 && gameSpend >= gameBudgetUsd) {
      inFlightPromptRef.current = null;
      setStatus({
        kind: "paused",
        message: `AI budget reached (${gameSpend.toFixed(2)} / ${gameBudgetUsd.toFixed(2)}). Raise the cap or take over manually.`,
      });
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
      signal: controller.signal,
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
        setStatus({ kind: "error", message });
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
  ]);
}
