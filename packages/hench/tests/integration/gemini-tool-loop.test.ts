/**
 * Gemini agentic tool-use loop integration test.
 *
 * Validates that `agentLoop()` with `llm.vendor=google` drives a real
 * multi-turn tool-use loop (not the legacy single-turn completion):
 *
 *   1. Turn 1 — model returns a `functionCall` (write_file) → dispatched
 *      through the shared tool dispatcher (file actually written, guarded).
 *   2. Turn 2 — model returns text with no functionCall → run completes.
 *
 * The Gemini provider is mocked via `defaultRegistry.getActiveProvider` so no
 * real Gemini API calls are made. Asserts tool dispatch, conversation
 * accrual, per-turn token attribution (vendor=google), and run status.
 *
 * @see packages/hench/src/agent/lifecycle/loop.ts — runGeminiToolLoop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { initConfig } from "../../src/store/config.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type {
  GeminiToolProvider,
  GeminiContent,
  GeminiGenerateResult,
} from "../../src/prd/llm-gateway.js";

describe("Gemini agentic tool-use loop", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-gemini-loop-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);

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
          { id: "task-1", title: "Write the output file", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

    // Select Google as the active vendor.
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "google", google: { api_key: "AIza-test-key" } } }),
      "utf-8",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Build a mock GeminiToolProvider whose tool turns are scripted in order. */
  function mockGeminiProvider(turns: GeminiGenerateResult[]): GeminiToolProvider {
    let call = 0;
    const generateContentWithTools = vi.fn(
      async (_args: { contents: GeminiContent[] }): Promise<GeminiGenerateResult> => {
        const turn = turns[Math.min(call, turns.length - 1)];
        call += 1;
        return turn;
      },
    );
    return {
      info: { vendor: "google", mode: "api", model: "gemini-2.5-pro", capabilities: ["streaming", "function-calling"] },
      complete: vi.fn(),
      generateContentWithTools,
    } as unknown as GeminiToolProvider;
  }

  it("dispatches a tool call then completes on a text turn", async () => {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const provider = mockGeminiProvider([
      // Turn 1: request a write_file tool call
      {
        parts: [{ functionCall: { name: "write_file", args: { path: "gemini-output.txt", content: "written by gemini" } } }],
        functionCalls: [{ name: "write_file", args: { path: "gemini-output.txt", content: "written by gemini" } }],
        text: "",
        finishReason: "STOP",
        usage: { input: 100, output: 20 },
      },
      // Turn 2: no tool calls → completion
      {
        parts: [{ text: "Done — the file is written." }],
        functionCalls: [],
        text: "Done — the file is written.",
        finishReason: "STOP",
        usage: { input: 40, output: 10 },
      },
    ]);

    const spy = vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config,
      store,
      projectDir,
      henchDir,
      model: "gemini-2.5-pro",
      yes: true,
      autonomous: true,
    });

    expect(spy).toHaveBeenCalled();

    // The loop ran two turns and completed.
    expect(result.run.turns).toBe(2);
    expect(result.run.status).toBe("completed");
    expect(result.run.summary).toContain("Done");

    // The write_file tool was actually dispatched (file written under projectDir).
    expect(existsSync(join(projectDir, "gemini-output.txt"))).toBe(true);
    const written = await readFile(join(projectDir, "gemini-output.txt"), "utf-8");
    expect(written).toContain("written by gemini");

    // Tool call recorded in the run.
    expect(result.run.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.run.toolCalls[0].tool).toBe("write_file");

    // Per-turn token usage attributed to google.
    expect(result.run.turnTokenUsage).toBeDefined();
    expect(result.run.turnTokenUsage!.length).toBe(2);
    for (const t of result.run.turnTokenUsage!) {
      expect(t.vendor).toBe("google");
    }
    // Accumulated totals (100+40 input, 20+10 output).
    expect(result.run.tokenUsage.input).toBe(140);
    expect(result.run.tokenUsage.output).toBe(30);

    // The loop passed function declarations to the provider.
    const firstCallArgs = (provider.generateContentWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCallArgs.tools[0].functionDeclarations.length).toBeGreaterThan(0);
    expect(firstCallArgs.tools[0].functionDeclarations.some((d: { name: string }) => d.name === "write_file")).toBe(true);
  });

  it("completes in a single turn when the model emits no tool calls", async () => {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const provider = mockGeminiProvider([
      {
        parts: [{ text: "Nothing to do." }],
        functionCalls: [],
        text: "Nothing to do.",
        finishReason: "STOP",
        usage: { input: 12, output: 4 },
      },
    ]);
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });

    expect(result.run.turns).toBe(1);
    expect(result.run.status).toBe("completed");
    expect(result.run.toolCalls.length).toBe(0);
  });
});
