/**
 * Livelock detection through a real agent loop (GH #362).
 *
 * Drives `agentLoop()` with a scripted Gemini provider — the same harness
 * `gemini-tool-loop.test.ts` uses — because the defect is a property of the
 * loop, not of the detector in isolation: a model that keeps asking for the
 * same tool call must stop the run with a message naming that call, and a
 * model that repeats a call *around real edits* must not be touched.
 *
 * @see packages/hench/src/agent/analysis/livelock.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../src/store/config.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type {
  GeminiToolProvider,
  GeminiContent,
  GeminiGenerateResult,
} from "../../src/prd/llm-gateway.js";

describe("livelock detection in the agent loop", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-livelock-"));
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
          { id: "task-1", title: "Do the work", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(projectDir, "target.txt"), "unchanging contents", "utf-8");

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

  /** A provider that answers every turn with `nextTurn(callCount)`. */
  function scriptedProvider(
    nextTurn: (call: number) => GeminiGenerateResult,
  ): GeminiToolProvider {
    let call = 0;
    return {
      info: { vendor: "google", mode: "api", model: "gemini-2.5-pro", capabilities: ["function-calling"] },
      complete: vi.fn(),
      generateContentWithTools: vi.fn(async (_args: { contents: GeminiContent[] }) => nextTurn(call++)),
    } as unknown as GeminiToolProvider;
  }

  function toolTurn(name: string, args: Record<string, unknown>): GeminiGenerateResult {
    return {
      parts: [{ functionCall: { name, args } }],
      functionCalls: [{ name, args }],
      text: "",
      finishReason: "STOP",
      usage: { input: 10, output: 2 },
    };
  }

  async function runLoop() {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    return agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });
  }

  it("stops a run repeating one call, naming the call", async () => {
    // Reading the same file over and over: identical name, identical arguments,
    // identical result, nothing written — the shape of the #362 poll loop.
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(
      scriptedProvider(() => toolTurn("read_file", { path: "target.txt" })),
    );

    const { run } = await runLoop();

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Livelock");
    expect(run.error).toContain("read_file");
    // Stopped at the threshold, nowhere near the 50-turn cap.
    expect(run.turns).toBeLessThan(10);
  }, 30_000);

  it("leaves a run alone when the same call brackets real edits", async () => {
    // A fix loop: read the same file, write a new version, read again. The
    // write is the progress signal — twelve turns must not trip the detector.
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(
      scriptedProvider((call) => {
        if (call >= 12) {
          return {
            parts: [{ text: "Done." }],
            functionCalls: [],
            text: "Done.",
            finishReason: "STOP",
            usage: { input: 10, output: 2 },
          };
        }
        return call % 2 === 0
          ? toolTurn("read_file", { path: "target.txt" })
          : toolTurn("write_file", { path: "target.txt", content: `revision ${call}` });
      }),
    );

    const { run } = await runLoop();

    expect(run.error).toBeUndefined();
    expect(run.status).toBe("completed");
    expect(run.turns).toBe(13);
  }, 30_000);

  it("is disabled by hench.livelockThreshold = 0", async () => {
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(
      scriptedProvider((call) =>
        call >= 20
          ? {
              parts: [{ text: "Done." }],
              functionCalls: [],
              text: "Done.",
              finishReason: "STOP",
              usage: { input: 10, output: 2 },
            }
          : toolTurn("read_file", { path: "target.txt" }),
      ),
    );

    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    config.livelockThreshold = 0;
    const store = createStore("file", join(projectDir, ".rex"));

    const { run } = await agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });

    expect(run.status).toBe("completed");
    expect(run.turns).toBe(21);
  }, 30_000);
});
