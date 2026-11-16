import { describe, it, expect, vi } from "vitest";
import { ClaudeClientError } from "@n-dx/llm-client";
const { complete, appendLog } = vi.hoisted(() => ({ complete: vi.fn(), appendLog: vi.fn() }));
vi.mock("@n-dx/llm-client", async (original) => ({
  ...await original<typeof import("@n-dx/llm-client")>(),
  createLLMClient: () => ({ mode: "cli", complete }),
}));
vi.mock("../../../src/store/index.js", () => ({
  resolveRexPaths: () => ({ rexDir: "fixture" }),
  resolveStore: async () => ({ appendLog }),
}));
import { setProjectDir, setLLMConfig, spawnClaude } from "../../../src/analyze/llm-bridge.js";

describe("Rex failed completion accounting", () => {
  it.each(["provider", "filesystem"])("writes %s failure spend once while leaving successful spend to command aggregation", async (kind) => {
    appendLog.mockClear();
    setProjectDir("fixture");
    setLLMConfig({ vendor: "codex" });
    const error = Object.assign(kind === "provider" ? new ClaudeClientError("failed", "network", false) : new Error("EACCES: output file unreadable"), {
      tokenUsage: { input: 20, output: 5, cacheReadInput: 80 }, usageStatus: "measured",
    });
    complete.mockRejectedValueOnce(error);
    await expect(spawnClaude("fixture", "gpt-5.4")).rejects.toBe(error);
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(JSON.parse(appendLog.mock.calls[0][0].detail)).toMatchObject({
      calls: 1, outcome: "failed", inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 80,
      usageStatus: "measured", vendor: "codex", model: "gpt-5.4",
    });
    complete.mockResolvedValueOnce({ text: "exact", tokenUsage: error.tokenUsage });
    await expect(spawnClaude("fixture")).resolves.toMatchObject({ text: "exact", tokenUsage: error.tokenUsage });
    expect(appendLog).toHaveBeenCalledTimes(1);
  });
  it.each(["unavailable", "malformed", "measured"] as const)("records %s accounting without double-counting a successful call", async (usageStatus) => {
    appendLog.mockClear();
    setProjectDir("fixture");
    setLLMConfig({ vendor: "codex" });
    complete.mockResolvedValueOnce({ text: "exact", usageStatus,
      tokenUsage: usageStatus === "measured" ? { input: 0, output: 0 } : undefined });
    await spawnClaude("fixture");
    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(appendLog.mock.calls[0][0].event).toBe("llm_usage_diagnostic");
    expect(JSON.parse(appendLog.mock.calls[0][0].detail).usageStatus).toBe(usageStatus);
  });

  it("does not replace a measured provider failure when the execution log is unwritable", async () => {
    setProjectDir("fixture");
    setLLMConfig({ vendor: "codex" });
    const error = Object.assign(new ClaudeClientError("provider failed", "network", false), {
      tokenUsage: { input: 20, output: 5, cacheReadInput: 80 }, usageStatus: "measured",
    });
    complete.mockRejectedValueOnce(error);
    appendLog.mockRejectedValueOnce(new Error("EACCES: execution log is read-only"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(spawnClaude("fixture")).rejects.toBe(error);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
    } finally {
      warning.mockRestore();
    }
  });

  it("returns successful text when an accounting diagnostic cannot be persisted", async () => {
    setProjectDir("fixture");
    setLLMConfig({ vendor: "codex" });
    complete.mockResolvedValueOnce({ text: "exact", usageStatus: "unavailable" });
    appendLog.mockRejectedValueOnce(new Error("EACCES: execution log is read-only"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(spawnClaude("fixture")).resolves.toMatchObject({ text: "exact", usageStatus: "unavailable" });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
    } finally {
      warning.mockRestore();
    }
  });

});
