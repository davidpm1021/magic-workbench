import { useMemo, useState } from "react";
import { Bot, Brain, Download, FastForward, Play, RefreshCw, Sparkles, UserRound } from "lucide-react";
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
import { classifyWorkbenchDecision } from "@/workbench/decisionImportance";
import { formatUsd } from "@/workbench/pricing";
import { buildWorkbenchDecisionContext } from "@/workbench/controllerPolicy";
import { downloadWorkbenchAudit } from "@/workbench/auditExport";

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
  const gameLog = useGameStore((state) => state.gameLog);
  const respond = useGameStore((state) => state.respond);

  const controllerMode = useWorkbenchStore((state) => state.controllerMode);
  const aiBaseUrl = useWorkbenchStore((state) => state.aiBaseUrl);
  const aiModel = useWorkbenchStore((state) => state.aiModel);
  const aiFastModel = useWorkbenchStore((state) => state.aiFastModel);
  const aiApiKey = useWorkbenchStore((state) => state.aiApiKey);
  const strategyPrompt = useWorkbenchStore((state) => state.strategyPrompt);
  const autoYieldTrivial = useWorkbenchStore((state) => state.autoYieldTrivial);
  const gameBudgetUsd = useWorkbenchStore((state) => state.gameBudgetUsd);
  const recommendation = useWorkbenchStore((state) => state.recommendation);
  const history = useWorkbenchStore((state) => state.history);
  const auditLog = useWorkbenchStore((state) => state.auditLog);
  const recovery = useWorkbenchStore((state) => state.recovery);
  const status = useWorkbenchStore((state) => state.status);
  const setControllerMode = useWorkbenchStore((state) => state.setControllerMode);
  const setAiBaseUrl = useWorkbenchStore((state) => state.setAiBaseUrl);
  const setAiModel = useWorkbenchStore((state) => state.setAiModel);
  const setAiFastModel = useWorkbenchStore((state) => state.setAiFastModel);
  const setAiApiKey = useWorkbenchStore((state) => state.setAiApiKey);
  const setStrategyPrompt = useWorkbenchStore((state) => state.setStrategyPrompt);
  const setAutoYieldTrivial = useWorkbenchStore((state) => state.setAutoYieldTrivial);
  const setGameBudgetUsd = useWorkbenchStore((state) => state.setGameBudgetUsd);
  const setRecommendation = useWorkbenchStore((state) => state.setRecommendation);
  const clearHistory = useWorkbenchStore((state) => state.clearHistory);
  const addAuditEntry = useWorkbenchStore((state) => state.addAuditEntry);
  const retryRecovery = useWorkbenchStore((state) => state.retryRecovery);
  const resolveRecoveryManually = useWorkbenchStore(
    (state) => state.resolveRecoveryManually,
  );
  const setStatus = useWorkbenchStore((state) => state.setStatus);

  const [showConfig, setShowConfig] = useState(false);
  const promptSupported = isWorkbenchAiPrompt(currentPrompt);
  const currentPromptId = Number(currentPrompt?.promptId ?? 0);
  const recommendationIsCurrent =
    recommendation != null && recommendation.promptId === currentPromptId;
  const classification = currentPrompt ? classifyWorkbenchDecision(currentPrompt) : null;
  const selectedModel =
    classification?.importance === "routine" && aiFastModel.trim()
      ? aiFastModel.trim()
      : aiModel.trim();
  const currentGameHistory = useMemo(
    () => history.filter((item) => item.gameId === gameView?.gameId),
    [history, gameView?.gameId],
  );
  const currentGameAudit = useMemo(
    () => auditLog.filter((item) => item.gameId === gameView?.gameId),
    [auditLog, gameView?.gameId],
  );
  const currentGameSpend = useMemo(
    () =>
      currentGameAudit.reduce(
        (sum, item) => sum + (item.estimatedCostUsd ?? 0),
        0,
      ),
    [currentGameAudit],
  );
  const paidDecisionCount = currentGameAudit.filter((item) => item.source === "ai").length;
  const auditErrorCount = currentGameAudit.filter((item) => item.status === "error").length;
  const budgetReached = gameBudgetUsd > 0 && currentGameSpend >= gameBudgetUsd;

  const actionCount = useMemo(() => {
    if (!currentPrompt) return 0;
    if (currentPrompt.input.type === "chooseAction") {
      return currentPrompt.input.actions.length + 1;
    }
    if (currentPrompt.input.type === "payManaCost") {
      return currentPrompt.input.actions.length;
    }
    return 0;
  }, [currentPrompt]);

  const configured = aiBaseUrl.trim().length > 0 && aiModel.trim().length > 0;
  const usingLocalProxy = aiBaseUrl.trim().startsWith("/workbench-ai");
  const canAsk =
    configured &&
    promptSupported &&
    gameView != null &&
    currentPrompt != null &&
    !isWaitingForResponse &&
    status.kind !== "thinking" &&
    !budgetReached;

  const askAi = async () => {
    if (!currentPrompt || !gameView || !promptSupported) return;
    if (budgetReached) {
      setStatus({
        kind: "paused",
        message: `AI budget reached (${formatUsd(currentGameSpend)} / ${formatUsd(gameBudgetUsd)}). Raise the cap before making another paid call.`,
      });
      return;
    }
    setStatus({
      kind: "thinking",
      message: `${selectedModel} is analyzing this ${classification?.importance ?? "current"} decision...`,
    });
    try {
      const next = await requestWorkbenchDecision({
        baseUrl: aiBaseUrl,
        model: selectedModel,
        apiKey: aiApiKey,
        strategyPrompt,
        gameView,
        prompt: currentPrompt,
        myPlayerSlot,
        decisionContext: buildWorkbenchDecisionContext({
          auditLog,
          gameView,
          gameLog,
          currentPrompt,
        }),
        onAuditEntry: addAuditEntry,
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

  const exportGameAudit = () => {
    if (!gameView || currentGameAudit.length === 0) return;
    downloadWorkbenchAudit({
      gameId: gameView.gameId,
      entries: currentGameAudit,
      winnerId: gameView.gameOver ? gameView.winnerId ?? null : undefined,
      turn: gameView.gameOver ? gameView.turn : undefined,
    });
  };

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
        <div
          className={
            budgetReached
              ? "rounded-md border border-destructive/40 bg-destructive/10 p-2"
              : "rounded-md border border-border/50 bg-background/60 p-2"
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">AI spend this game</span>
            <span>{formatUsd(currentGameSpend)}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Soft cap {gameBudgetUsd > 0 ? formatUsd(gameBudgetUsd) : "off"} • {paidDecisionCount} paid call(s)
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Current decision</p>
            <p className="text-muted-foreground">
              {currentPrompt ? currentPrompt.input.type : "Waiting for a prompt"}
              {promptSupported
                ? ` • ${classification?.importance ?? "decision"}${actionCount > 0 ? ` • ${actionCount} choices` : ""}`
                : ""}
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
            variant="primary"
            className="h-8 px-2 text-[11px]"
            disabled={!recommendationIsCurrent || isWaitingForResponse}
            onClick={() => void actOnce()}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Act once
          </Button>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border/50 bg-background/60 p-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoYieldTrivial}
            onChange={(event) => setAutoYieldTrivial(event.target.checked)}
          />
          <span>
            <span className="font-medium">Auto-yield trivial priority</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              Automatically passes only when the engine exposes zero legal actions.
            </span>
          </span>
        </label>

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

        {recovery && currentPromptId === recovery.promptId ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-2">
            <div>
              <p className="font-semibold">AI paused on this decision</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {recovery.mode === "manual"
                  ? "Make this choice using the normal game controls. Thinking AI will resume automatically on the next prompt."
                  : recovery.error}
              </p>
            </div>
            {recovery.mode === "error" ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-[11px]"
                  disabled={budgetReached || isWaitingForResponse}
                  onClick={retryRecovery}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Retry AI
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2 text-[11px]"
                  disabled={isWaitingForResponse}
                  onClick={resolveRecoveryManually}
                >
                  <UserRound className="mr-1.5 h-3.5 w-3.5" />
                  Resolve manually
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!promptSupported && currentPrompt ? (
          <p className="text-[10px] text-muted-foreground">
            This prompt is informational or not yet supported by Thinking AI. It remains under
            manual control.
          </p>
        ) : null}
      </section>

      {currentGameHistory.length > 0 ? (
        <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Recent AI decisions</p>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={clearHistory}
            >
              Clear
            </button>
          </div>
          <div className="space-y-1.5">
            {currentGameHistory
              .slice(-5)
              .reverse()
              .map((item) => (
                <div
                  key={`${item.promptId}-${item.createdAt}`}
                  className="rounded-md border border-border/50 bg-background/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-medium">
                      {item.promptType} • {item.importance}
                    </span>
                    <span className="text-muted-foreground">{item.latencyMs} ms</span>
                  </div>
                  <p className="mt-1 break-all text-[10px]">{item.label}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {item.model}
                    {item.estimatedCostUsd != null ? ` • ${formatUsd(item.estimatedCostUsd)}` : ""}
                    {item.usage ? ` • ${item.usage.totalTokens.toLocaleString()} tokens` : ""}
                  </p>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold">Game decision audit</p>
            <p className="text-[10px] text-muted-foreground">
              {currentGameAudit.length} events • {paidDecisionCount} AI calls • {auditErrorCount} error(s)
            </p>
          </div>
          <Download className="h-4 w-4 text-muted-foreground" />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full px-2 text-[11px]"
          disabled={currentGameAudit.length === 0}
          onClick={exportGameAudit}
        >
          Export full game audit (.json)
        </Button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Includes the visible game state, engine prompt, chosen output, brief model reason, token
          usage, estimated cost, latency, deterministic actions, and errors for every logged event.
        </p>
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
              <span className="text-muted-foreground">Strategic model</span>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                placeholder="your-model"
                value={aiModel}
                onChange={(event) => setAiModel(event.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground">Routine model, optional</span>
              <input
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                placeholder="leave blank to use the main model"
                value={aiFastModel}
                onChange={(event) => setAiFastModel(event.target.value)}
              />
            </label>
            {usingLocalProxy ? (
              <p className="rounded-md border border-border/50 bg-background/60 p-2 text-[10px] text-muted-foreground">
                Secure local proxy enabled. The provider credential stays in the PowerShell/Vite
                process and is not sent to browser storage.
              </p>
            ) : (
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
            )}
            <label className="block space-y-1">
              <span className="text-muted-foreground">Per-game AI budget (USD)</span>
              <input
                type="number"
                min="0"
                step="0.25"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                value={gameBudgetUsd}
                onChange={(event) => setGameBudgetUsd(Number(event.target.value) || 0)}
              />
              <span className="block text-[10px] text-muted-foreground">
                Workbench stops new AI calls after this estimated spend. Set 0 to disable the cap.
              </span>
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
              The local proxy is the preferred browser path. Direct endpoints remain available for
              local OpenAI-compatible servers and advanced testing.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
