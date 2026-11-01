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
 *   3. A whole-file write_file that would blank an existing file is refused,
 *      and the change lands through edit_file with the file otherwise intact.
 *   4. A refused connection is retried on llm.local.* and then hench.retry.*
 *      before the run fails, and the failure names the settings to raise.
 *   5. A turn LM Studio rejects as malformed model output — a 400, or an
 *      error event inside the stream — is resent on llm.local.maxFormatRetries
 *      and the run carries on; when the resends run out the failure names that
 *      setting.
 *
 * Every completion is requested streamed (the headers then arrive at once, so
 * a slow turn is not cut off by Node's 300 s wait for them), and the fake
 * answers as LM Studio does: server-sent events with tool-call arguments split
 * across chunks and a usage chunk at the end. The loop must see the same tool
 * calls, reasoning and usage the non-streamed response carried.
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
import { commitGitFixtureBaseline, disableMemoryGuard } from "../helpers/index.js";
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

/**
 * The same turn as LM Studio streams it: reasoning and content in two pieces
 * each, each tool call's name in its first delta and its arguments in three
 * fragments, then the finish_reason chunk, the include_usage chunk and [DONE].
 */
function chatStreamEvents(turn: ScriptedTurn): string[] {
  const full = chatResponse(turn);
  const choice = (full["choices"] as Array<Record<string, unknown>>)[0]!;
  const message = choice["message"] as Record<string, unknown>;
  const event = (delta: Record<string, unknown>, finish: unknown = null): string =>
    "data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] }) + "\n\n";
  const halves = (text: string): string[] => [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))];
  const events = [event({ role: "assistant" })];
  if (typeof message["reasoning_content"] === "string") {
    for (const piece of halves(message["reasoning_content"])) events.push(event({ reasoning_content: piece }));
  }
  if (typeof message["content"] === "string") {
    for (const piece of halves(message["content"])) events.push(event({ content: piece }));
  }
  const calls = (message["tool_calls"] as ScriptedTurn["tool_calls"]) ?? [];
  calls.forEach((call, index) => {
    events.push(event({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } }] }));
    const args = call.function.arguments;
    const third = Math.ceil(args.length / 3);
    for (const piece of [args.slice(0, third), args.slice(third, 2 * third), args.slice(2 * third)]) {
      events.push(event({ tool_calls: [{ index, type: "function", function: { arguments: piece } }] }));
    }
  });
  events.push(event({}, choice["finish_reason"]));
  events.push("data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage: full["usage"] }) + "\n\n");
  events.push("data: [DONE]\n\n");
  return events;
}

/** An SSE response carrying `events`, each its own network chunk. */
function sseResponse(events: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) controller.enqueue(enc.encode(e));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("Local (OpenAI-compatible) agentic tool-use loop", () => {
  let projectDir: string;
  let henchDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-local-loop-"));
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
    commitGitFixtureBaseline(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(projectDir, { recursive: true, force: true });
  });

  /**
   * Stub global fetch to answer chat/completions from a script, in order,
   * streamed (see chatStreamEvents). Requests WITHOUT a `tools` field are the
   * condenser's summarization calls — they get a fixed summary and do not
   * consume the script.
   */
  function stubChatEndpoint(turns: ScriptedTurn[]): void {
    let call = 0;
    fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      const turn: ScriptedTurn = !("tools" in body)
        ? { content: "Summary: earlier files were read; remaining work: finish the output file." }
        : turns[Math.min(call++, turns.length - 1)]!;
      return sseResponse(chatStreamEvents(turn));
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

  async function runLoop(overrides: {
    livelockThreshold?: number;
    provider?: "api";
    retry?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  } = {}) {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    // `ndx work` runs this loop with provider "api" (run.ts effectiveConfig).
    if (overrides.provider) config.provider = overrides.provider;
    if (overrides.retry) config.retry = overrides.retry;
    if (overrides.livelockThreshold !== undefined) {
      config.livelockThreshold = overrides.livelockThreshold;
    }
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
            arguments: JSON.stringify({ path: "local-output.ts", content: "export const source = 'local';\n" }),
          },
        }],
        finish_reason: "stop",
      },
      // Turn 2: stage the output as the API prompt requires.
      {
        content: null,
        tool_calls: [{
          id: "call-2",
          type: "function",
          function: {
            name: "git",
            arguments: JSON.stringify({ subcommand: "add", args: "local-output.ts" }),
          },
        }],
        finish_reason: "stop",
      },
      // Turn 3: leave the commit handoff for the non-interactive finalizer.
      {
        content: null,
        tool_calls: [{
          id: "call-3",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: ".hench-commit-msg.txt", content: "feat: write local output\n" }),
          },
        }],
        finish_reason: "stop",
      },
      // Turn 4: no tool calls → completion claim, valid because a file changed.
      { content: "Done — the file is written.", finish_reason: "stop" },
    ]);

    const { result } = await runLoop();

    expect(existsSync(join(projectDir, "local-output.ts"))).toBe(true);
    const written = await readFile(join(projectDir, "local-output.ts"), "utf-8");
    expect(written).toContain("local");

    expect(result.run.status).toBe("completed");
    expect(result.run.turns).toBe(4);
    expect(result.run.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.run.toolCalls[0].tool).toBe("write_file");
    // The streamed arguments were reassembled whole: the file holds exactly
    // what the scripted call carried.
    expect(written).toBe("export const source = 'local';\n");
    // Every turn was requested streamed with usage, and the usage chunks were
    // counted as the non-streamed usage was: 4 turns × (100 in, 20 out).
    for (const c of fetchMock.mock.calls) {
      expect(JSON.parse((c[1] as { body: string }).body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    }
    expect(result.run.tokenUsage).toMatchObject({ input: 400, output: 80 });
    // This completed through the real git-derived path, not a mocked verdict.
    // Asked of the file's own history rather than of HEAD: the PRD completion
    // record is committed after the work, so HEAD is that record and the work
    // is HEAD~1. Which commit it landed in is not what this test is about.
    expect(execFileSync("git", ["log", "--format=", "--name-only", "--", "local-output.ts"], {
      cwd: projectDir,
      encoding: "utf-8",
    })).toContain("local-output.ts");
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
    // These are fixture setup, not agent work. Commit them before the loop so
    // the API run captures a clean, deterministic baseline.
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "context baseline"], { cwd: projectDir, stdio: "ignore" });

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
            arguments: JSON.stringify({ path: "final-output.ts", content: "export const done = true;\n" }),
          },
        }],
        prompt_tokens: 10_000,
      },
      // Turn 9: stage the output.
      {
        content: null,
        tool_calls: [{
          id: "c9",
          type: "function",
          function: { name: "git", arguments: JSON.stringify({ subcommand: "add", args: "final-output.ts" }) },
        }],
        prompt_tokens: 10_000,
      },
      // Turn 10: hand the staged work to the commit finalizer.
      {
        content: null,
        tool_calls: [{
          id: "c10",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: ".hench-commit-msg.txt", content: "feat: write final output\n" }),
          },
        }],
        prompt_tokens: 10_000,
      },
      // Turn 11: completion claim.
      { content: "Done.", prompt_tokens: 10_000 },
    ]);

    // This test exercises context compaction, not livelock detection; its
    // intentionally repeated reads have no writes until the final edit.
    const { result } = await runLoop({ livelockThreshold: 0 });

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
    expect(toolRequestBodies.some((body) =>
      JSON.stringify(body.messages).includes("[tool output condensed]"),
    )).toBe(true);
  });

  it("refuses a write_file that blanks an existing file, then lands the change through edit_file", async () => {
    mockLocalProvider();
    // A file large enough for the shrink guard, committed so the run's
    // baseline holds it.
    const original = Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i};`).join("\n") +
      "\nexport const pattern = /old-regex/;\n";
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src/extract.ts"), original, "utf-8");
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "extract baseline"], { cwd: projectDir, stdio: "ignore" });

    const call = (id: string, name: string, args: Record<string, unknown>): ScriptedTurn => ({
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    });
    stubChatEndpoint([
      // What gpt-oss-20b did: send back a placeholder, then nothing at all.
      call("w1", "write_file", { path: "src/extract.ts", content: "/* updated */" }),
      call("w2", "write_file", { path: "src/extract.ts", content: "" }),
      // Pointed at edit_file by the refusal, it changes the one line.
      call("e1", "edit_file", { path: "src/extract.ts", old_string: "/old-regex/", new_string: "/new-regex/" }),
      call("g1", "git", { subcommand: "add", args: "src/extract.ts" }),
      call("m1", "write_file", { path: ".hench-commit-msg.txt", content: "fix: update the extract regex\n" }),
      { content: "Done.", finish_reason: "stop" },
    ]);

    const { result } = await runLoop({ provider: "api" });

    const after = await readFile(join(projectDir, "src/extract.ts"), "utf-8");
    expect(after).toBe(original.replace("/old-regex/", "/new-regex/"));

    const [w1, w2, e1] = result.run.toolCalls;
    expect(w1.tool).toBe("write_file");
    expect(w1.output).toMatch(/^\[GUARD\] write_file refused.*edit_file/s);
    expect(w2.output).toMatch(/^\[GUARD\] write_file refused/);
    expect(e1.tool).toBe("edit_file");
    expect(e1.output).toMatch(/^Edited src\/extract\.ts/);
    expect(result.run.status).toBe("completed");

    // The system prompt the local model saw tells it to edit, not rewrite, and
    // the tool list offers edit_file.
    const firstBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const system = firstBody.messages.find((m: { role: string }) => m.role === "system");
    expect(system.content).toContain("use edit_file");
    expect(firstBody.tools.map((t: { function: { name: string } }) => t.function.name)).toContain("edit_file");
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

  /** The completing script: write, stage, hand off the commit, claim done. */
  const completingTurns = (): ScriptedTurn[] => [
    {
      content: null,
      tool_calls: [{ id: "r1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "out.ts", content: "export {};\n" }) } }],
    },
    {
      content: null,
      tool_calls: [{ id: "r2", type: "function", function: { name: "git", arguments: JSON.stringify({ subcommand: "add", args: "out.ts" }) } }],
    },
    {
      content: null,
      tool_calls: [{ id: "r3", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: ".hench-commit-msg.txt", content: "feat: out\n" }) } }],
    },
    { content: "Done." },
  ];

  async function writeLocalSettings(local: Record<string, unknown>): Promise<void> {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { host: "localhost", port: 1234, ...local } } }),
      "utf-8",
    );
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "local settings"], { cwd: projectDir, stdio: "ignore" });
  }

  describe("a dropped LM Studio connection", () => {
    /** Refuse the first `failures` requests the way Node's fetch does, then answer from the script. */
    function stubFlakyEndpoint(failures: number): void {
      stubChatEndpoint(completingTurns());
      const answer = fetchMock.getMockImplementation()!;
      let refused = 0;
      fetchMock.mockImplementation(async (...args: unknown[]) => {
        if (refused < failures) {
          refused++;
          throw Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1234"), { code: "ECONNREFUSED" }),
          });
        }
        return (answer as (...a: unknown[]) => Promise<Response>)(...args);
      });
    }

    it("retries on llm.local.* and completes the task", async () => {
      mockLocalProvider();
      await writeLocalSettings({ maxRetries: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
      stubFlakyEndpoint(3);

      const { result } = await runLoop({ retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } });

      expect(result.run.status).toBe("completed");
      expect(existsSync(join(projectDir, "out.ts"))).toBe(true);
    });

    it("retries again on hench.retry.* once llm.local.* runs out", async () => {
      mockLocalProvider();
      // No in-provider retries at all: only the run-level policy can save it.
      await writeLocalSettings({ maxRetries: 0 });
      stubFlakyEndpoint(2);

      const { result } = await runLoop({ retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 } });

      expect(result.run.status).toBe("completed");
    });

    it("fails the run naming the server and the settings to raise when both run out", async () => {
      mockLocalProvider();
      await writeLocalSettings({ maxRetries: 1, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
      stubFlakyEndpoint(100);

      const { result, store } = await runLoop({ retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 } });

      expect(result.run.status).toBe("failed");
      expect(result.run.error).toContain("Cannot reach local server at http://localhost:1234/v1");
      expect(result.run.error).toContain("after 2 attempts");
      expect(result.run.error).toContain("llm.local.maxRetries");
      // llm.local: 2 attempts, twice (one hench.retry).
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const doc = await store.loadDocument();
      expect(doc!.items.find((i: { id: string }) => i.id === "task-1")!.status).toBe("pending");
    });
  });
  describe("malformed model output", () => {
    /** LM Studio's 400 when the model emitted a tool call in the wrong shape. */
    const MALFORMED = JSON.stringify({
      error:
        "Engine protocol predict stream returned an error: " +
        JSON.stringify({
          code: 500,
          message: "The model produced output that does not match the expected peg-native format",
          type: "server_error",
        }),
    });

    /** The same failure as LM Studio reports it once a streamed response has begun. */
    const MALFORMED_EVENT =
      "event: error\ndata: " +
      JSON.stringify({
        error: {
          message:
            "Engine protocol predict stream returned an error: " +
            "The model produced output that does not match the expected peg-native format",
        },
      }) +
      "\n\n";

    /**
     * Answer the `failOn`-th tool turn (1-based) as malformed `times` times —
     * an HTTP 400, or an error event inside the stream — then carry on.
     */
    function stubMalformedTurn(failOn: number, times: number, form: "status" | "stream" = "status"): void {
      stubChatEndpoint(completingTurns());
      const answer = fetchMock.getMockImplementation()!;
      let toolTurns = 0;
      let rejected = 0;
      fetchMock.mockImplementation(async (...args: unknown[]) => {
        const init = args[1] as { body?: string } | undefined;
        const isToolTurn = init?.body ? "tools" in JSON.parse(init.body) : false;
        if (isToolTurn && toolTurns + 1 === failOn && rejected < times) {
          rejected++;
          return form === "stream"
            ? sseResponse([`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "x" } }] })}\n\n`, MALFORMED_EVENT])
            : new Response(MALFORMED, { status: 400, statusText: "Bad Request" });
        }
        if (isToolTurn) toolTurns++;
        return (answer as (...a: unknown[]) => Promise<Response>)(...args);
      });
    }

    it("resends the turn on llm.local.maxFormatRetries and the run carries on to completion", async () => {
      mockLocalProvider();
      await writeLocalSettings({ maxFormatRetries: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
      // The second turn (after write_file ran) comes back malformed twice.
      stubMalformedTurn(2, 2);

      const { result } = await runLoop();

      expect(result.run.status).toBe("completed");
      expect(existsSync(join(projectDir, "out.ts"))).toBe(true);
      // Four scripted turns plus the two resends.
      expect(fetchMock.mock.calls.filter((c) => {
        const init = c[1] as { body?: string } | undefined;
        return init?.body ? "tools" in JSON.parse(init.body) : false;
      })).toHaveLength(6);
    });

    it("resends a turn whose malformed output arrives inside the stream", async () => {
      mockLocalProvider();
      await writeLocalSettings({ maxFormatRetries: 3, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
      stubMalformedTurn(2, 1, "stream");

      const { result } = await runLoop();

      expect(result.run.status).toBe("completed");
      expect(fetchMock.mock.calls.filter((c) => {
        const init = c[1] as { body?: string } | undefined;
        return init?.body ? "tools" in JSON.parse(init.body) : false;
      })).toHaveLength(5);
    });

    it("fails the run naming llm.local.maxFormatRetries when the resends run out", async () => {
      mockLocalProvider();
      await writeLocalSettings({ maxFormatRetries: 1, retryBaseDelayMs: 1, retryMaxDelayMs: 1 });
      stubMalformedTurn(1, 100);

      const { result, store } = await runLoop({ retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 } });

      expect(result.run.status).toBe("failed");
      expect(result.run.error).toContain("produced malformed output");
      expect(result.run.error).toContain("llm.local.maxFormatRetries (now 1)");
      // One send and one resend; hench.retry does not resend a format failure.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const doc = await store.loadDocument();
      expect(doc!.items.find((i: { id: string }) => i.id === "task-1")!.status).toBe("pending");
    });
  });
});
