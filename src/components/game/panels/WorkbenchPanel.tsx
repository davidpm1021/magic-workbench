import { useMemo, useState } from "react";
import { Bot, Brain, FastForward, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/stores/useGameStore";
import {
  type WorkbenchControllerMode,
  useWorkbenchStore,
} from "@/stores/useWorkbenchStore";
import {
  isWorkbenchAiPrompt,
  requestWorkbenchDecision,
} from "@/workbench/aiDecision";

const CONTROLLER_OPTIONS: Array<{
  value: WorkbenchControllerMode;
  label: string;
  description: string;
}> = [
  {
    value: "manual",
    label: "Manual",
    description: "You make every meaningful decision.",
  },
  {
    value: "assisted",
    label: "AI assisted",
    description: "Ask for a line, then decide whether to use it.",
  },
  {
    value: "thinking-ai",
    label: "Thinking AI takeover",
    description: "The model automatically acts on supported engine prompts.",
  },
];

export function WorkbenchPanel() {
  const currentPrompt = useGameStore((state) => state.currentPrompt);
  const gameView = useGameStore((state) => state.gameView);
  const myPlayerSlot = useGameStore((state) => state.myPlayerSlot);
  const isWaitingForResponse = useGameStore((state) => state.isWaitingForResponse);
  const respond = useGameStore((state) => state.respond);

  const controllerMode = useWorkbenchStore((state) => state.controllerMode);
  const aiBaseUrl = useWorkbenchStore((state) => state.aiBaseUrl);
  const aiModel = useWorkbenchStore((state) => state.aiModel);
  const aiApiKey = useWorkbenchStore((state) => state.aiApiKey);
  const strategyPrompt = useWorkbenchStore((state) => state.strategyPrompt);
  const recommendation = useWorkbenchStore((state) => state.recommendation);
  const status = useWorkbenchStore((state) => state.status);
  const setControllerMode = useWorkbenchStore((state) => state.setControllerMode);
  const setAiBaseUrl = useWorkbenchStore((state) => state.setAiBaseUrl);
  const setAiModel = useWorkbenchStore((state) => state.setAiModel);
  const setAiApiKey = useWorkbenchStore((state) => state.setAiApiKey);
  const setStrategyPrompt = useWorkbenchStore((state) => state.setStrategyPrompt);
  const setRecommendation = useWorkbenchStore((state) => state.setRecommendation);
  const setStatus = useWorkbenchStore((state) => state.setStatus);

  const [showConfig, setShowConfig] = useState(false);
  const promptSupported = isWorkbenchAiPrompt(currentPrompt);
  const recommendationIsCurrent =
    recommendation != null && recommendation.promptId === currentPrompt?.promptId;

  const actionCount = useMemo(() => {
    if (!currentPrompt || !isWorkbenchAiPrompt(currentPrompt)) return 0;
    return currentPrompt.input.actions.length + (currentPrompt.input.type === "chooseAction" ? 1 : 0);
  }, [currentPrompt]);

  const configured = aiBaseUrl.trim().length > 0 && aiModel.trim().length > 0;
  const canAsk =
    configured &&
    promptSupported &&
    gameView != null &&
    currentPrompt != null &&
    !isWaitingForResponse &&
    status.kind !== "thinking";

  const askAi = async () => {
    if (!currentPrompt || !gameView || !promptSupported) return;
    setStatus({
      kind: "thinking",
      message: `${aiModel} is analyzing ${actionCount} legal choices...`,
    });
    try {
      const next = await requestWorkbenchDecision({
        baseUrl: aiBaseUrl,
        model: aiModel,
        apiKey: aiApiKey,
        strategyPrompt,
        gameView,
        prompt: currentPrompt,
        myPlayerSlot,
      });
      setRecommendation(next);
      setStatus({ kind: "ready", message: next.reason });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ kind: "error", message });
    }
  };

  const actOnce = async () => {
    if (!recommendationIsCurrent || !recommendation || isWaitingForResponse) return;
    setStatus({ kind: "ready", message: `Executing: ${recommendation.reason}` });
    await respond(recommendation.output);
  };

  const fastForward = async () => {
    if (currentPrompt?.input.type !== "chooseAction" || isWaitingForResponse) return;
    setStatus({
      kind: "idle",
      message: "Passing priority and exhausting the current stack sequence.",
    });
    await respond({ type: "pass", exhaustStack: true });
  };

  const recommendationLabel = recommendation?.label ?? null;

  return (
    <div className="min-h-0 flex-1 space-y-3 text-xs">
      <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <p className="font-semibold">Seat controller</p>
        </div>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-2 text-xs"
          value={controllerMode}
          onChange={(event) => setControllerMode(event.target.value as WorkbenchControllerMode)}
        >
          {CONTROLLER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground">
          {CONTROLLER_OPTIONS.find((option) => option.value === controllerMode)?.description}
        </p>
      </section>

      <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Current decision</p>
            <p className="text-muted-foreground">
              {currentPrompt ? currentPrompt.input.type : "Waiting for a prompt"}
              {promptSupported ? ` • ${actionCount} choices` : ""}
            </p>
          </div>
          <Brain className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-[11px]"
            disabled={!canAsk}
            onClick={() => void askAi()}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Ask AI
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 text-[11px]"
            disabled={!recommendationIsCurrent || isWaitingForResponse}
            onClick={() => void actOnce()}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Act once
          </Button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="h-8 w-full px-2 text-[11px]"
          disabled={currentPrompt?.input.type !== "chooseAction" || isWaitingForResponse}
          onClick={() => void fastForward()}
        >
          <FastForward className="mr-1.5 h-3.5 w-3.5" />
          Fast-forward routine priority
        </Button>

        {recommendationIsCurrent && recommendationLabel ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
            <p className="font-semibold break-all">{recommendationLabel}</p>
            <p className="mt-1 text-muted-foreground">{recommendation.reason}</p>
          </div>
        ) : null}

        <div
          className={
            status.kind === "error"
              ? "rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive"
              : "rounded-md border border-border/50 bg-background/60 p-2 text-muted-foreground"
          }
        >
          {status.message}
        </div>

        {!promptSupported && currentPrompt ? (
          <p className="text-[10px] text-muted-foreground">
            This prompt is informational or not yet supported by Thinking AI. It remains under
            manual control.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <button
          type="button"
          className="w-full text-left font-semibold"
          onClick={() => setShowConfig((value) => !value)}
        >
          AI connection {showConfig ? "▾" : "▸"}
        </button>
        {showConfig ? (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-muted-foreground">OpenAI-compatible base URL</span>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                placeholder="http://localhost:1234/v1"
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Model</span>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                placeholder="your-model"
                value={aiModel}
                onChange={(event) => setAiModel(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">API key, session only</span>
              <input
                type="password"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                placeholder="optional for local endpoints"
                value={aiApiKey}
                onChange={(event) => setAiApiKey(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Pilot instructions</span>
              <textarea
                className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5"
                value={strategyPrompt}
                onChange={(event) => setStrategyPrompt(event.target.value)}
              />
            </label>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Credentials are kept only in the in-memory Workbench store. For browser play, prefer a
              local OpenAI-compatible proxy instead of exposing a provider key to client code.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
