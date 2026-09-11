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
  /** Reported prompt size — drives the loop's context-pressure measurement. */
  prompt_tokens?: number;
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
    usage: { prompt_tokens: turn.prompt_tokens ?? 100, completion_tokens: 20 },
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

  /**
   * Stub global fetch to answer chat/completions from a script, in order.
   * Requests WITHOUT a `tools` field are the condenser's summarization calls —
   * they get a fixed summary and do not consume the script.
   */
  function stubChatEndpoint(turns: ScriptedTurn[]): void {
    let call = 0;
    fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      const turn: ScriptedTurn = !("tools" in body)
        ? { content: "Summary: earlier files were read; remaining work: finish the output file." }
        : turns[Math.min(call++, turns.length - 1)]!;
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

  it("condenses the window under measured context pressure and records the count", async () => {
    mockLocalProvider();

    // A window small enough (relative to the scripted prompt_tokens) that the
    // loop crosses 70% (digest) and then 90% (summarize).
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        llm: { vendor: "local", local: { host: "localhost", port: 1234, maxContextTokens: 100_000 } },
      }),
      "utf-8",
    );
    // A file large enough that its read_file output is worth digesting.
    await writeFile(join(projectDir, "big-notes.txt"), "x".repeat(1_200), "utf-8");

    const readTurn = (id: string, promptTokens: number): ScriptedTurn => ({
      content: null,
      tool_calls: [{
        id,
        type: "function",
        function: { name: "read_file", arguments: JSON.stringify({ path: "big-notes.txt" }) },
      }],
      prompt_tokens: promptTokens,
    });

    stubChatEndpoint([
      // Turns 1-5: build up history well under the window.
      readTurn("c1", 10_000),
      readTurn("c2", 10_000),
      readTurn("c3", 10_000),
      readTurn("c4", 10_000),
      readTurn("c5", 10_000),
      // Turn 6: 71% — digest stage fires on the old tool outputs.
      readTurn("c6", 71_000),
      // Turn 7: 95% — summarization stage replaces the middle of the history.
      readTurn("c7", 95_000),
      // Turn 8: real work so the completion claim is valid.
      {
        content: null,
        tool_calls: [{
          id: "c8",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "final-output.txt", content: "done" }),
          },
        }],
        prompt_tokens: 10_000,
      },
      // Turn 9: completion claim.
      { content: "Done.", prompt_tokens: 10_000 },
    ]);

    const { result } = await runLoop();

    expect(result.run.status).toBe("completed");
    // Both stages fired: at least one digest event and one summarize event.
    expect(result.run.contextCondensations).toBeGreaterThanOrEqual(2);

    // The digested tool outputs and the summary actually reached the model:
    // inspect the tool-call requests sent AFTER each condensation.
    const toolRequestBodies = fetchMock.mock.calls
      .map((c) => JSON.parse((c[1] as { body: string }).body))
      .filter((b) => "tools" in b);
    const allSentText = JSON.stringify(toolRequestBodies.at(-1)!.messages);
    expect(allSentText).toContain("[Earlier context condensed]");
    const postDigestText = JSON.stringify(toolRequestBodies.at(-3)!.messages);
    expect(postDigestText).toContain("[tool output condensed]");
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
