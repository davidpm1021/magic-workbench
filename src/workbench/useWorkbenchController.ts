import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  isWorkbenchAiPrompt,
  requestWorkbenchDecision,
} from "./aiDecision";

export function useWorkbenchController(paused = false): void {
  const currentPrompt = useGameStore((state) => state.currentPrompt);
  const isWaitingForResponse = useGameStore((state) => state.isWaitingForResponse);
  const respond = useGameStore((state) => state.respond);

  const controllerMode = useWorkbenchStore((state) => state.controllerMode);
  const aiBaseUrl = useWorkbenchStore((state) => state.aiBaseUrl);
  const aiModel = useWorkbenchStore((state) => state.aiModel);
  const aiApiKey = useWorkbenchStore((state) => state.aiApiKey);
  const strategyPrompt = useWorkbenchStore((state) => state.strategyPrompt);
  const autoYieldTrivial = useWorkbenchStore((state) => state.autoYieldTrivial);
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
  ]);

  useEffect(() => {
    if (paused || controllerMode !== "thinking-ai") return;
    if (!currentPrompt || isWaitingForResponse) return;
    if (autoYieldTrivial && currentPrompt.input.type === "chooseAction" && currentPrompt.input.actions.length === 0) return;

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

    if (inFlightPromptRef.current === currentPrompt.promptId) return;
    inFlightPromptRef.current = currentPrompt.promptId;

    const promptId = currentPrompt.promptId;
    const controller = new AbortController();
    const state = useGameStore.getState();
    const gameView = state.gameView;

    if (!gameView) {
      inFlightPromptRef.current = null;
      return;
    }

    setStatus({
      kind: "thinking",
      message: `${aiModel} is choosing from the engine's legal actions...`,
    });

    void requestWorkbenchDecision({
      baseUrl: aiBaseUrl,
      model: aiModel,
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
          latestGame.currentPrompt?.promptId !== promptId
        ) {
          return;
        }

        setRecommendation(recommendation);
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
    aiApiKey,
    strategyPrompt,
    autoYieldTrivial,
    respond,
    setRecommendation,
    setStatus,
  ]);
}
