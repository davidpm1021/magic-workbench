import { describe, expect, it } from "vitest";
import { estimateOpenAiCostUsd, formatUsd } from "./pricing";

describe("Workbench pricing", () => {
  it("estimates Sol usage from input and output tokens", () => {
    expect(
      estimateOpenAiCostUsd("gpt-5.6-sol", {
        inputTokens: 5_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1_000,
        reasoningTokens: 700,
        totalTokens: 6_000,
      }),
    ).toBeCloseTo(0.04, 8);
  });

  it("prices Luna much lower than Sol", () => {
    const usage = {
      inputTokens: 5_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 500,
      totalTokens: 6_000,
    };
    const sol = estimateOpenAiCostUsd("gpt-5.6-sol", usage);
    const luna = estimateOpenAiCostUsd("gpt-5.6-luna", usage);
    expect(sol).not.toBeNull();
    expect(luna).not.toBeNull();
    expect(luna!).toBeLessThan(sol! / 10);
  });

  it("accounts for cached input", () => {
    const allFresh = estimateOpenAiCostUsd("gpt-5.6-terra", {
      inputTokens: 10_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 10_000,
    });
    const mostlyCached = estimateOpenAiCostUsd("gpt-5.6-terra", {
      inputTokens: 10_000,
      cachedInputTokens: 9_000,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 10_000,
    });
    expect(mostlyCached!).toBeLessThan(allFresh!);
  });

  it("returns null for unknown provider pricing", () => {
    expect(
      estimateOpenAiCostUsd("local-model", {
        inputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 100,
        reasoningTokens: 0,
        totalTokens: 200,
      }),
    ).toBeNull();
  });

  it("formats tiny costs without rounding them to zero", () => {
    expect(formatUsd(0.0004)).toBe("$0.0004");
    expect(formatUsd(0.0042)).toBe("$0.004");
    expect(formatUsd(0.042)).toBe("$0.04");
  });
});
