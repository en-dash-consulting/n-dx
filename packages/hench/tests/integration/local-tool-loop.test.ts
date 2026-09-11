/**
 * Local (LM Studio / OpenAI-compatible) agentic tool-use loop integration test.
 *
 * Validates that `agentLoop()` with `llm.vendor=local` behaves like the CLI
 * vendors at the seams that diverged in practice:
 *
 *   1. Tool calls are dispatched whenever `tool_calls` is populated — even when
 *      the server reports `finish_reason: "stop"` (LM Studio does this for some
 *      models; treating it as completion silently discarded the calls).
 *   2. A completion claim with no changes gets execution re-prompts, and when
 *      the model still changes nothing the run FAILS with the task reset to
 *      pending — never a false "completed".
 *
 * The chat/completions endpoint is mocked via a global fetch stub — no LM
 * Studio required. The provider registry is mocked the same way as the Gemini
 * loop test.
 *
 * @see packages/hench/src/agent/lifecycle/loop.ts — runLocalToolLoop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type { LLMProvider } from "../../src/prd/llm-gateway.js";

/** One scripted chat/completions response body. */
interface ScriptedTurn {
  content?: string | null;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  finish_reason?: string;
}

function chatResponse(turn: ScriptedTurn): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: turn.content ?? null,
          ...(turn.reasoning_content ? { reasoning_content: turn.reasoning_content } : {}),
          ...(turn.tool_calls ? { tool_calls: turn.tool_calls } : {}),
        },
        finish_reason: turn.finish_reason ?? "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

describe("Local (OpenAI-compatible) agentic tool-use loop", () => {
  let projectDir: string;
  let henchDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-local-loop-"));
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

    // Select local as the active vendor.
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { host: "localhost", port: 1234 } } }),
      "utf-8",
    );

    // Completion validation discovers changes via git; without a repo (and a
    // baseline commit) every completion claim is rejected as unverifiable.
    initGitFixtureRepoSync(projectDir);
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Stub global fetch to answer chat/completions from a script, in order. */
  function stubChatEndpoint(turns: ScriptedTurn[]): void {
    let call = 0;
    fetchMock = vi.fn(async () => {
      const turn = turns[Math.min(call, turns.length - 1)]!;
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => chatResponse(turn),
        text: async () => JSON.stringify(chatResponse(turn)),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  function mockLocalProvider(): void {
    const provider = {
      info: { vendor: "local", mode: "api", model: "qwen-test", capabilities: ["function-calling"] },
      complete: vi.fn(),
    } as unknown as LLMProvider;
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);
  }

  async function runLoop() {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config, store, projectDir, henchDir,
      model: "qwen-test", yes: true, autonomous: true,
    });
    return { result, store };
  }

  it("dispatches tool calls even when finish_reason is 'stop'", async () => {
    mockLocalProvider();
    stubChatEndpoint([
      // Turn 1: a thinking model returns reasoning + a tool call, and LM Studio
      // labels it finish_reason "stop". The call must still be dispatched.
      {
        content: null,
        reasoning_content: "I should write the file now.",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "local-output.txt", content: "written by local model" }),
          },
        }],
        finish_reason: "stop",
      },
      // Turn 2: no tool calls → completion claim, valid because a file changed.
      { content: "Done — the file is written.", finish_reason: "stop" },
    ]);

    const { result } = await runLoop();

    expect(existsSync(join(projectDir, "local-output.txt"))).toBe(true);
    const written = await readFile(join(projectDir, "local-output.txt"), "utf-8");
    expect(written).toContain("written by local model");

    expect(result.run.status).toBe("completed");
    expect(result.run.turns).toBe(2);
    expect(result.run.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.run.toolCalls[0].tool).toBe("write_file");
  });

  it("re-prompts a no-change completion claim, then fails the run — same standard as the CLI loop", async () => {
    mockLocalProvider();
    // The model never calls a tool and keeps declaring itself done.
    stubChatEndpoint([
      { content: "Task is already complete.", finish_reason: "stop" },
    ]);

    const { result, store } = await runLoop();

    // Initial claim + 2 execution re-prompts = 3 model calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const lastBody = JSON.parse(fetchMock.mock.calls[2]![1].body as string);
    const lastUserMsg = lastBody.messages.filter((m: { role: string }) => m.role === "user").at(-1);
    expect(lastUserMsg.content).toContain("have not changed any files");

    // The claim is rejected, not recorded as completed.
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("No changes detected");

    // The task went back to pending so the next cycle retries it.
    const doc = await store.loadDocument();
    const task = doc!.items.find((i: { id: string }) => i.id === "task-1");
    expect(task!.status).toBe("pending");
  });
});
