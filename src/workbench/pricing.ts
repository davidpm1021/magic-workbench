export interface WorkbenchTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
}

const LONG_CONTEXT_THRESHOLD = 272_000;

// OpenAI list pricing checked 2026-09-22. These are deliberately kept local
// and treated as estimates because providers and prices can change.
const OPENAI_PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
  {
    prefix: "gpt-5.6-sol",
    pricing: {
      inputPerMillion: 4,
      cachedInputPerMillion: 0.4,
      cacheWritePerMillion: 5,
      outputPerMillion: 20,
    },
  },
  {
    prefix: "gpt-5.6-terra",
    pricing: {
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      cacheWritePerMillion: 2.5,
      outputPerMillion: 12,
    },
  },
  {
    prefix: "gpt-5.6-luna",
    pricing: {
      inputPerMillion: 0.2,
      cachedInputPerMillion: 0.02,
      cacheWritePerMillion: 0.25,
      outputPerMillion: 1.2,
    },
  },
];

export function emptyWorkbenchUsage(): WorkbenchTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function estimateOpenAiCostUsd(
  model: string,
  usage: WorkbenchTokenUsage | null | undefined,
): number | null {
  if (!usage) return null;
  const entry = OPENAI_PRICING.find(({ prefix }) => model.toLowerCase().startsWith(prefix));
  if (!entry) return null;

  const cached = Math.max(0, Math.min(usage.cachedInputTokens, usage.inputTokens));
  const writes = Math.max(
    0,
    Math.min(usage.cacheWriteTokens, Math.max(usage.inputTokens - cached, 0)),
  );
  const uncached = Math.max(usage.inputTokens - cached - writes, 0);
  const longContext = usage.inputTokens > LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const p = entry.pricing;

  return (
    (uncached * p.inputPerMillion * inputMultiplier +
      cached * p.cachedInputPerMillion * inputMultiplier +
      writes * p.cacheWritePerMillion * inputMultiplier +
      usage.outputTokens * p.outputPerMillion * outputMultiplier) /
    1_000_000
  );
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (value < 0.001) return `$${value.toFixed(4)}`;
  if (value < 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
