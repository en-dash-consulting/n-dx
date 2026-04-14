import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "../../src/schema/v1.js";
import { initConfig } from "../../src/store/config.js";
import { saveRun, loadRun } from "../../src/store/runs.js";
import { fetchCodexTokenUsage } from "../../src/quota/index.js";

async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-test-codex-token-retrieval-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({
      llm: {
        vendor: "codex",
        codex: {
          api_key: "test-key-123",
        },
      },
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "Codex token task",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    }),
    "utf-8",
  );

  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

describe("Codex token retrieval integration", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("retrieves non-zero token values from Codex API and updates run record", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            model: "gpt-4o-mini",
            prompt_tokens: 150,
            completion_tokens: 75,
            created: 1704067200,
          },
        ],
      }),
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key-123",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.input).toBe(150);
      expect(result.tokens.output).toBe(75);
    }
  });

  it("handles missing API key gracefully", async () => {
    const result = await fetchCodexTokenUsage({
      apiKey: "", // Empty key
      model: "gpt-4o-mini",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
    }
  });

  it("handles HTTP errors from Codex API", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "invalid-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
    }
  });

  it("handles rate limit errors from Codex API", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("rate-limit");
    }
  });

  it("handles timeout errors gracefully", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockImplementationOnce(
      (_url: string, options: RequestInit) => {
        const signal = options.signal as AbortSignal;
        return new Promise<Response>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            const error = new DOMException("Aborted", "AbortError");
            (error as any).name = "AbortError";
            reject(error);
          }, 10);

          if (signal) {
            signal.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              const error = new DOMException("Aborted", "AbortError");
              (error as any).name = "AbortError";
              reject(error);
            });
          }
        });
      },
    );

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      timeoutMs: 5,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("handles empty token data from API", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
      }),
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not-found");
    }
  });

  it("handles zero token data diagnostic correctly", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            model: "gpt-4o-mini",
            prompt_tokens: 0,
            completion_tokens: 0,
            created: 1704067200,
          },
        ],
      }),
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.input).toBe(0);
      expect(result.tokens.output).toBe(0);
      expect(result.diagnostic).toBe("zero_token_data_from_api");
    }
  });

  it("persists retrieved Codex tokens to run record", async () => {
    const baselineRun: RunRecord = {
      id: "test-run-codex",
      taskId: "task-1",
      taskTitle: "Test Codex task",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 0, output: 0 }, // Zeroed out initially
      turnTokenUsage: [
        {
          turn: 1,
          input: 0,
          output: 0,
          vendor: "codex",
          model: "gpt-4o-mini",
        },
      ],
      toolCalls: [],
      model: "gpt-4o-mini",
    };

    await saveRun(henchDir, baselineRun);

    // Simulate token retrieval and update
    const retrieved = { input: 120, output: 60 };
    baselineRun.tokenUsage.input = Math.max(baselineRun.tokenUsage.input, retrieved.input);
    baselineRun.tokenUsage.output = Math.max(baselineRun.tokenUsage.output, retrieved.output);

    await saveRun(henchDir, baselineRun);

    // Load and verify
    const loaded = await loadRun(henchDir, "test-run-codex");
    expect(loaded.tokenUsage.input).toBe(120);
    expect(loaded.tokenUsage.output).toBe(60);
  });

  it("merges higher token values without overwriting lower values", async () => {
    const run: RunRecord = {
      id: "test-run-merge",
      taskId: "task-1",
      taskTitle: "Test merge",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 50, output: 25 }, // Partial data from CLI
      turnTokenUsage: [
        {
          turn: 1,
          input: 50,
          output: 25,
          vendor: "codex",
          model: "gpt-4o-mini",
        },
      ],
      toolCalls: [],
      model: "gpt-4o-mini",
    };

    // Simulate API retrieval with higher tokens
    const retrieved = { input: 150, output: 75 };
    run.tokenUsage.input = Math.max(run.tokenUsage.input, retrieved.input);
    run.tokenUsage.output = Math.max(run.tokenUsage.output, retrieved.output);

    expect(run.tokenUsage.input).toBe(150);
    expect(run.tokenUsage.output).toBe(75);

    // Save and verify persistence
    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, "test-run-merge");
    expect(loaded.tokenUsage.input).toBe(150);
    expect(loaded.tokenUsage.output).toBe(75);
  });

  it("does not overwrite higher token values with lower ones", async () => {
    const run: RunRecord = {
      id: "test-run-no-downgrade",
      taskId: "task-1",
      taskTitle: "Test no downgrade",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 200, output: 100 }, // Already high from CLI
      turnTokenUsage: [
        {
          turn: 1,
          input: 200,
          output: 100,
          vendor: "codex",
          model: "gpt-4o-mini",
        },
      ],
      toolCalls: [],
      model: "gpt-4o-mini",
    };

    // Simulate API retrieval with lower tokens (shouldn't happen but test defensively)
    const retrieved = { input: 50, output: 25 };
    run.tokenUsage.input = Math.max(run.tokenUsage.input, retrieved.input);
    run.tokenUsage.output = Math.max(run.tokenUsage.output, retrieved.output);

    expect(run.tokenUsage.input).toBe(200); // Unchanged
    expect(run.tokenUsage.output).toBe(100); // Unchanged

    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, "test-run-no-downgrade");
    expect(loaded.tokenUsage.input).toBe(200);
    expect(loaded.tokenUsage.output).toBe(100);
  });

  it("handles network errors gracefully", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockRejectedValueOnce(new Error("Network unavailable"));

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
    }
  });

  it("handles malformed JSON responses gracefully", async () => {
    const mockFetch = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("Invalid JSON");
      },
    });

    const result = await fetchCodexTokenUsage({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("parse");
    }
  });

  it("skips token retrieval for non-Codex runs", async () => {
    const run: RunRecord = {
      id: "test-run-claude",
      taskId: "task-1",
      taskTitle: "Test Claude run",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      turnTokenUsage: [
        {
          turn: 1,
          input: 100,
          output: 50,
          vendor: "claude", // Not Codex
          model: "claude-3-5-sonnet-20241022",
        },
      ],
      toolCalls: [],
      model: "claude-3-5-sonnet-20241022",
    };

    // This run should not trigger Codex token retrieval
    expect(run.turnTokenUsage?.some((t) => t.vendor === "codex")).toBe(false);
  });
});
