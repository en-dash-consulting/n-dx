/**
 * USD spend caps through an API-provider agent loop.
 *
 * `hench.maxCostUsdPerRun` / `hench.maxCostUsdPerDay` were checked only before
 * a CLI vendor spawn, so a task moved to an API provider (a saved
 * `run.provider`, which PRD content can set) escaped them. The API, Gemini and
 * local loops now run the same gate before every model request. Driven here
 * with the scripted Gemini provider the livelock suite uses.
 *
 * @see packages/hench/src/agent/lifecycle/spend-cap.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitGitFixtureBaseline, disableMemoryGuard } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type { GeminiToolProvider, GeminiGenerateResult } from "../../src/prd/llm-gateway.js";

describe("spend caps in the API agent loop", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-api-spend-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await disableMemoryGuard(henchDir);

    const rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [
          { id: "task-1", title: "Do the work", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(projectDir, "target.ts"), "export const target = 'initial';\n", "utf-8");
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "google", google: { api_key: "AIza-test-key" } } }),
      "utf-8",
    );
    commitGitFixtureBaseline(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Every turn reads a file and reports a million input tokens. */
  function expensiveProvider(): GeminiToolProvider & { generateContentWithTools: ReturnType<typeof vi.fn> } {
    const turn: GeminiGenerateResult = {
      parts: [{ functionCall: { name: "read_file", args: { path: "target.ts" } } }],
      functionCalls: [{ name: "read_file", args: { path: "target.ts" } }],
      text: "",
      finishReason: "STOP",
      usage: { input: 1_000_000, output: 0 },
    };
    return {
      info: { vendor: "google", mode: "api", model: "gemini-2.5-pro", capabilities: ["function-calling"] },
      complete: vi.fn(),
      generateContentWithTools: vi.fn(async () => turn),
    } as unknown as GeminiToolProvider & { generateContentWithTools: ReturnType<typeof vi.fn> };
  }

  async function runLoop(caps: { maxCostUsdPerRun?: number; maxCostUsdPerDay?: number }) {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    config.livelockThreshold = 0;
    Object.assign(config, caps);
    const store = createStore("file", join(projectDir, ".rex"));
    return agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });
  }

  it("stops before the next request once the per-run cap is reached", async () => {
    const provider = expensiveProvider();
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    // A million input tokens costs far more than a hundredth of a cent at any
    // rate llm-client prices, so the first turn exhausts the cap.
    const { run } = await runLoop({ maxCostUsdPerRun: 0.0001 });

    expect(run.status).toBe("budget_exceeded");
    expect(run.error).toContain("hench.maxCostUsdPerRun");
    expect(provider.generateContentWithTools).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("stops before the first request when today's ledger is already over the per-day cap", async () => {
    const provider = expensiveProvider();
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const runsDir = join(henchDir, "runs");
    await mkdir(runsDir, { recursive: true });
    const startedAt = new Date().toISOString();
    await writeFile(
      join(runsDir, "earlier-run.json"),
      JSON.stringify({
        id: "earlier-run",
        taskId: "task-0",
        taskTitle: "Earlier",
        startedAt,
        finishedAt: startedAt,
        status: "completed",
        turns: 1,
        model: "gemini-2.5-pro",
        tokenUsage: { input: 1_000_000, output: 0 },
        toolCalls: [],
      }),
      "utf-8",
    );

    const { run } = await runLoop({ maxCostUsdPerDay: 0.0001 });

    expect(run.status).toBe("budget_exceeded");
    expect(run.error).toContain("hench.maxCostUsdPerDay");
    expect(provider.generateContentWithTools).not.toHaveBeenCalled();
  }, 30_000);
});
