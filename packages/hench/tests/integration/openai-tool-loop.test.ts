/** Synthetic Responses transport; real codec, tool guard, store and run finalization. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitGitFixtureBaseline, disableMemoryGuard } from "../helpers/index.js";
import { initConfig, loadConfig } from "../../src/store/config.js";
import { listRuns } from "../../src/store/runs.js";
import { ExecutionQueue } from "../../src/queue/execution-queue.js";
import { agentLoop } from "../../src/agent/lifecycle/loop.js";
import { createStore } from "@n-dx/rex/dist/store/index.js";
import type { HenchConfig } from "../../src/schema/index.js";

const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed",
});
const done = { type: "message", role: "assistant", content: [{ type: "output_text", text: "Implemented and verified the file." }] };
const response = (output: unknown[], status = "completed") => new Response(JSON.stringify({
  status, model: "gpt-6-astra", output,
  usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 25 } },
}), { headers: { "Content-Type": "application/json" } });

describe("direct OpenAI agent execution", () => {
  let projectDir: string;
  let henchDir: string;
  let store: ReturnType<typeof createStore>;
  let config: HenchConfig;
  let requests: Array<Record<string, any>>;
  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-openai-loop-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await disableMemoryGuard(henchDir);
    const rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }));
    await writeFile(join(rexDir, "prd.json"), JSON.stringify({ schema: "rex/v1", title: "Test", items: [
      { id: "task-1", title: "Write output", status: "pending", level: "task", priority: "high" },
      { id: "task-2", title: "Write second output", status: "pending", level: "task", priority: "medium" },
    ] }));
    await writeFile(join(rexDir, "execution-log.jsonl"), "");
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex", codex: { auth: "api", api_key: "fixture-key", model: "gpt-6-astra" } } }));
    await writeFile(join(projectDir, "target.ts"), "export const initial = true;\n");
    await writeFile(join(projectDir, ".gitignore"), ".run-logs/\n.hench-commit-msg.txt\n.n-dx.local.json\n");
    commitGitFixtureBaseline(projectDir);
    store = createStore("file", rexDir);
    config = await loadConfig(henchDir);
    config.provider = "api";
    config.skipFullTestGate = true;
    config.maxTurns = 8;
    config.livelockThreshold = 0;
    requests = [];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(projectDir, { recursive: true, force: true });
  });
  const scriptFor = (file: string) => [
    [call("write", "write_file", { path: file, content: "export const result = true;\n" }),
      { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" }],
    [call("stage", "git", { subcommand: "add", args: file })],
    [call("handoff", "write_file", { path: ".hench-commit-msg.txt", content: "feat: fixture output\n" })],
    [done],
  ];
  function script(turns: unknown[][]) {
    let index = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      requests.push(body);
      const summary = "Earlier turns read target.ts: export const initial = true;";
      if (url === "https://api.openai.com/v1/chat/completions") {
        // This pinned deployment exposes Sol only through Responses.
        if (body.model === "gpt-6.1-sol") return new Response(null, { status: 403 });
        return Response.json({
          choices: [{ message: { content: summary } }],
          usage: { prompt_tokens: 60, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 15 } },
        });
      }
      expect(url).toBe("https://api.openai.com/v1/responses");
      if (body.tools.length === 0) {
        return Response.json({
          status: "completed", model: body.model,
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: summary }] }],
          usage: { input_tokens: 60, output_tokens: 10, input_tokens_details: { cached_tokens: 15 } },
        });
      }
      return response(turns[index++] ?? [done]);
    }));
  }
  const run = (taskId = "task-1", abortSignal?: AbortSignal, model = "gpt-6-astra") => agentLoop({
    config, store, projectDir, henchDir, taskId, model,
    yes: true, autonomous: true, abortSignal,
  });

  it.each([false, true])("resumes max-token output safely (reasoning only=%s)", async reasoningOnly => {
    script(scriptFor("resumed.ts"));
    const success = globalThis.fetch;
    const partial = call("unfinished", "write_file", { path: "partial.ts", content: "must not execute" });
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: reasoningOnly ? [{ type: "reasoning", id: "rs_limit", summary: [], encrypted_content: "limited-reasoning" }]
        : [partial, { ...call("broken", "write_file", {}), status: "incomplete", arguments: '{"path":' },
          { ...done, status: "incomplete" }],
      usage: { input_tokens: 30, output_tokens: 90 },
    })).mockImplementation(success);
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(record.turnTokenUsage).toHaveLength(5);
    expect(record.tokenUsage).toMatchObject({ input: 330, output: 170, cacheReadInput: 100 });
    expect(record.toolCalls).toHaveLength(3);
    await expect(readFile(join(projectDir, "partial.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    const continuation = JSON.stringify(requests[0].input);
    expect(continuation).toContain("Your response was truncated");
    expect(requests[0].input.some((item: any) => item.type === "function_call" || item.type === "function_call_output")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("keeps a truncated Responses compaction summary out of subsequent turns", async () => {
    config.prune = { triggerPairs: 3, retainPairs: 2 };
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: { tiers: { codex: { light: "gpt-6.1-sol" } } } }));
    script([...["one", "two", "three", "four"].map(id => [call(id, "read_file", { path: "target.ts" })]), ...scriptFor("summarized.ts")]);
    const success = globalThis.fetch;
    const fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.tools?.length === 0) return Response.json({ status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ ...done, content: [{ type: "output_text", text: "TRUNCATED SUMMARY MUST NOT REPLAY" }] }],
        usage: { input_tokens: 10, output_tokens: 5 } });
      return success(url, init);
    });
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(JSON.stringify(requests)).not.toContain("TRUNCATED SUMMARY MUST NOT REPLAY");
    expect(record.toolCalls).toHaveLength(7);
    expect(fetch.mock.calls.filter(([, init]) => JSON.parse(init.body as string).tools?.length === 0)).toHaveLength(2);
  });

  async function selectClaude(fallback: boolean) {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: {
      vendor: fallback ? "codex" : "claude", autoFailover: true,
      codex: { lightModel: "gpt-6.1-sol" },
      claude: { auth: "api", api_key: "claude-fixture", model: "claude-sonnet-4-6" },
    } }));
  }

  it.each([false, true])("identifies a Claude refusal (fallback=%s) without another switch", async fallback => {
    await selectClaude(fallback);
    const fetch = vi.fn(async (url: string) => String(url).includes("openai")
      ? new Response(null, { status: 401 })
      : Response.json({ id: "refusal", type: "message", role: "assistant", model: "claude-sonnet-4-6",
        stop_reason: "refusal", content: [], usage: { input_tokens: 10, output_tokens: 2 } }));
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run("task-1", undefined, fallback ? "gpt-6-astra" : "claude-sonnet-4-6");
    expect(record.status).toBe("failed");
    expect(record.error).toBe("Claude refused the agent request");
    expect(fetch).toHaveBeenCalledTimes(fallback ? 3 : 1);
  });

  it.each(["codex", "claude", "fallback"])("cancels %s without deferral, failure events or another vendor attempt", async vendor => {
    if (vendor !== "codex") await selectClaude(vendor === "fallback");
    const controller = new AbortController();
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (vendor === "fallback" && String(url).includes("openai")) return new Response(null, { status: 401 });
      controller.abort();
      // A response/error racing the caller abort must never cause failover.
      init.signal?.throwIfAborted();
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run("task-1", controller.signal, vendor === "claude" ? "claude-sonnet-4-6" : "gpt-6-astra");
    expect(record.status).toBe("cancelled");
    expect((await store.getItem("task-1"))?.status).toBe("pending");
    expect((await store.getItem("task-2"))?.status).toBe("pending");
    const log = await readFile(join(projectDir, ".rex", "execution-log.jsonl"), "utf8");
    expect(log).toContain('"event":"task_cancelled"');
    expect(log).not.toContain('"event":"task_failed"');
    expect(fetch).toHaveBeenCalledTimes(vendor === "fallback" ? 3 : 1);
  });

  it.each(["codex", "claude"])("logs %s cancellation before the first API turn", async vendor => {
    if (vendor === "claude") await selectClaude(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run("task-1", AbortSignal.abort(), vendor === "claude" ? "claude-sonnet-4-6" : "gpt-6-astra");
    expect(record.status).toBe("cancelled");
    expect((await store.getItem("task-1"))?.status).toBe("pending");
    const log = await readFile(join(projectDir, ".rex", "execution-log.jsonl"), "utf8");
    expect(log).toContain('"event":"task_cancelled"');
    expect(log).not.toContain('"event":"task_failed"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("completes explicit tasks through Responses with useRegistryProvider=%s, preserving continuation and disjoint usage", async (useRegistryProvider) => {
    config.useRegistryProvider = useRegistryProvider;
    script([...scriptFor("first.ts"), ...scriptFor("second.ts")]);
    for (const id of ["task-1", "task-2"]) {
      const { run: record } = await run(id);
      expect(record.status).toBe("completed");
      expect(record.invocationContext).toBe("api");
      expect(record.tokenUsage).toMatchObject({ input: 300, output: 80, cacheReadInput: 100 });
      expect(record.turnTokenUsage).toHaveLength(4);
      expect(record.turnTokenUsage?.every(turn => turn.vendor === "codex" && turn.diagnosticStatus === "complete")).toBe(true);
      expect(JSON.stringify(record)).not.toContain("opaque-fixture");
      expect((await store.getItem(id))?.status).toBe("completed");
    }
    expect(requests[1].input).toContainEqual({ type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" });
    expect(requests[1].input.some((item: any) => item.type === "function_call_output" && item.call_id === "write")).toBe(true);
    expect(requests.every(request => request.model === "gpt-6-astra" && request.store === false)).toBe(true);
    expect(requests.every(request => request.include?.includes("reasoning.encrypted_content"))).toBe(true);
  });

  it("continues tools on a fallback model and records effective usage and switch cost", async () => {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: {
      autoFailover: true, codex: { lightModel: "gpt-6.1-sol" },
    } }));
    script(scriptFor("fallback.ts"));
    const success = globalThis.fetch;
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const body = JSON.parse(init.body as string);
      // Fail after the first tool result: switching must preserve the tool-call history.
      if (!failed && body.input.some((item: any) => item.type === "function_call_output")) {
        failed = true;
        return new Response("private provider payload", { status: 429, headers: { "Retry-After": "120" } });
      }
      const result = await success(url, init);
      const data = await result.json();
      return new Response(JSON.stringify({ ...data, model: body.model }), { headers: { "Content-Type": "application/json" } });
    }));
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(record.model).toBe("gpt-6.1-sol");
    expect(record.turnTokenUsage?.map(turn => [turn.model, turn.diagnosticStatus])).toEqual([
      ["gpt-6-astra", "complete"], ["gpt-6-astra", "unavailable"],
      ["gpt-6.1-sol", "complete"], ["gpt-6.1-sol", "complete"], ["gpt-6.1-sol", "complete"],
    ]);
    expect(record.tokenUsage).toMatchObject({ input: 300, output: 80, cacheReadInput: 100 });
    expect(record.diagnostics?.notes.some(note => note.includes("failover:") && note.includes("recorded cost USD"))).toBe(true);
    expect(JSON.stringify(record)).not.toContain("private provider payload");
    expect(requests[1].input.some((item: any) => item.type === "function_call" && item.call_id === "write")).toBe(true);
    expect(requests[1].input.some((item: any) => item.type === "reasoning")).toBe(false);
  });

  it("keeps a terminal Claude fallback error body out of the run record", async () => {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: {
      autoFailover: true, codex: { lightModel: "gpt-6.1-sol" },
      claude: { auth: "api", api_key: "private-claude-fixture" },
    } }));
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("openai")
      ? new Response("", { status: 401 })
      : new Response("invalid header value private-claude-fixture", { status: 400 })));
    const { run: record } = await run();
    expect(record.status).toBe("failed");
    expect(record.error).toContain("400");
    expect(JSON.stringify(record)).not.toContain("private-claude-fixture");
  });

  it("resumes a reasoning-only OpenAI turn on Claude with valid history and per-vendor usage", async () => {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: {
      autoFailover: true, codex: { lightModel: "gpt-6.1-sol" },
      claude: { auth: "api", api_key: "claude-fixture", model: "claude-sonnet-4-6" },
    } }));
    const turns = scriptFor("cross-vendor.ts");
    let index = 0;
    let openAiRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const body = JSON.parse(init.body as string);
      if (String(url).includes("openai")) {
        if (openAiRequests++ === 0) return Response.json({
          status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "reasoning", id: "rs_limit", summary: [] }],
          usage: { input_tokens: 30, output_tokens: 90 },
        });
        return new Response(null, { status: 401 });
      }
      if (body.messages.some((message: { content: unknown[] }) => message.content.length === 0)) {
        return new Response("messages must have non-empty content", { status: 400 });
      }
      expect(new Headers(init.headers).get("x-api-key")).toBe("claude-fixture");
      expect(body.tools[0].input_schema).toBeDefined();
      const content = turns[index++].filter((item: any) => item.type !== "reasoning").map((item: any) => item.type === "function_call"
        ? { type: "tool_use", id: item.call_id, name: item.name, input: JSON.parse(item.arguments) }
        : { type: "text", text: "Implemented and verified the file." });
      return new Response(JSON.stringify({ id: "msg_fixture", type: "message", role: "assistant", model: body.model,
        content, stop_reason: content.some((block: any) => block.type === "tool_use") ? "tool_use" : "end_turn",
        usage: { input_tokens: 50, output_tokens: 10 },
      }), { headers: { "Content-Type": "application/json" } });
    }));
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(record.vendor).toBe("claude");
    expect(record.model).toBe("claude-sonnet-4-6");
    expect(record.tokenUsage).toMatchObject({ input: 230, output: 130 });
    expect(record.turnTokenUsage?.slice(3).every(turn => turn.vendor === "claude" && turn.model === "claude-sonnet-4-6")).toBe(true);
    expect(JSON.stringify(record)).not.toContain("claude-fixture");
  });

  it("runs the command's sequential loop with real selection and claims", async () => {
    script([...scriptFor("first.ts"), ...scriptFor("second.ts")]);
    const { cmdRun } = await import("../../src/cli/commands/run.js");
    await cmdRun(projectDir, {
      loop: "true", provider: "api", model: "gpt-6-astra", yes: "true",
      "no-review": "true", "skip-test-gate": "true", "allow-dirty": "true", "loop-pause": "1",
    });
    expect((await store.getItem("task-1"))?.status).toBe("completed");
    expect((await store.getItem("task-2"))?.status).toBe("completed");
    expect(requests).toHaveLength(8);
  });

  it("queues the explicitly selected lower-priority task first on the API loop", async () => {
    const acquire = vi.spyOn(ExecutionQueue.prototype, "acquire");
    script([...scriptFor("second.ts"), ...scriptFor("first.ts")]);
    const { cmdRun } = await import("../../src/cli/commands/run.js");
    await cmdRun(projectDir, {
      loop: "true", task: "task-2", provider: "api", model: "gpt-6-astra", yes: "true",
      "no-review": "true", "skip-test-gate": "true", "allow-dirty": "true", "loop-pause": "1",
    });

    expect(acquire).toHaveBeenNthCalledWith(1, "task-2", "medium");
    const records = (await listRuns(henchDir)).reverse();
    expect(records.map(run => [run.taskId, run.invocationContext, run.status])).toEqual([
      ["task-2", "api", "completed"],
      ["task-1", "api", "completed"],
    ]);
    expect(requests).toHaveLength(8);
  });

  it("retains billed usage from an incomplete response without executing its tools", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([call("bad", "write_file", { path: "bad.ts", content: "bad" })], "incomplete")));
    const { run: record } = await run();
    expect(record.status).toBe("failed");
    expect(record.toolCalls).toEqual([]);
    expect(record.tokenUsage).toMatchObject({ input: 75, output: 20, cacheReadInput: 25 });
  });

  it("retries a transient API rejection without executing tools twice", async () => {
    script(scriptFor("retried.ts"));
    const success = globalThis.fetch;
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } })).mockImplementation(success);
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(record.toolCalls).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(record.tokenUsage.input).toBe(300);
  });

  it.each([
    { name: "default Codex tiers", llm: {}, summaryModel: "gpt-6-luna", effort: undefined },
    { name: "a light-tier pin", llm: { tiers: { codex: { light: "gpt-6.1-sol" } } }, summaryModel: "gpt-6.1-sol", effort: undefined },
    { name: "a legacy light-model pin", llm: { codex: { lightModel: "gpt-6-sol" } }, summaryModel: "gpt-6-sol", effort: undefined },
    { name: "a summary route and effort pin", llm: {
      routes: { "context.summarize": "heavy" }, tiers: { codex: { heavy: "gpt-6.1-sol" } },
      effort: { "context.summarize": "high" },
    }, summaryModel: "gpt-6.1-sol", effort: "high" },
  ])("compacts with $name and keeps summaries alongside retained tool continuations", async ({ llm, summaryModel, effort }) => {
    if (Object.keys(llm).length) await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm }));
    config.prune = { triggerPairs: 3, retainPairs: 2 };
    script([
      ...Array.from({ length: 4 }, (_, i) => [call(`read-${i}`, "read_file", { path: "target.ts" })]),
      ...scriptFor("compacted.ts"),
    ]);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    const summaries = requests.filter(request => !request.tools?.length);
    expect(summaries).toHaveLength(2);
    for (const request of summaries) {
      expect(request.model).toBe(summaryModel);
      if (summaryModel === "gpt-6.1-sol") {
        expect(request.tools).toEqual([]);
        expect(request.reasoning?.effort).toBe(effort);
        expect(request.max_output_tokens).toBe(config.maxTokens);
      } else {
        expect(request.tools).toBeUndefined();
        expect(request.reasoning_effort).toBe(effort);
        expect(request.max_completion_tokens).toBe(config.maxTokens);
      }
      expect(request).not.toHaveProperty("max_tokens");
    }
    expect((summaries[0].messages ?? summaries[0].input)[0].content).toContain("export const initial = true;");
    const turns = requests.filter(request => request.tools?.length);
    expect(turns[4].input).toContainEqual(expect.objectContaining({
      role: "user", content: expect.stringContaining("Earlier turns read target.ts: export const initial = true;"),
    }));
    expect(turns[4].input.filter((item: any) => item.type === "function_call").map((item: any) => item.call_id)).toEqual(["read-2", "read-3"]);
    expect(turns[4].input.filter((item: any) => item.type === "function_call_output").map((item: any) => item.call_id)).toEqual(["read-2", "read-3"]);
    expect(turns[6].input).toContainEqual({ type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" });
    expect(turns[6].input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "write" }));
    expect(record.tokenUsage).toMatchObject({ input: 8 * 75 + 2 * 45, output: 8 * 20 + 2 * 10, cacheReadInput: 8 * 25 + 2 * 15 });
    expect(record.turnTokenUsage?.filter(turn => turn.model === summaryModel)).toEqual([
      expect.objectContaining({ vendor: "codex", input: 45, output: 10, cacheReadInput: 15 }),
      expect.objectContaining({ vendor: "codex", input: 45, output: 10, cacheReadInput: 15 }),
    ]);
    expect(record.turnTokenUsage?.filter(turn => turn.model === "gpt-6-astra")).toHaveLength(8);
    expect(JSON.stringify(record)).not.toContain("opaque-fixture");
    expect(record.toolCalls).toHaveLength(7);
  });

  it("cancels a default summary request before sending another agent turn", async () => {
    config.prune = { triggerPairs: 3, retainPairs: 2 };
    const controller = new AbortController();
    script([
      ...Array.from({ length: 4 }, (_, i) => [call(`read-${i}`, "read_file", { path: "target.ts" })]),
      ...scriptFor("too-late.ts"),
    ]);
    const success = globalThis.fetch;
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/chat/completions")) {
        controller.abort();
        init.signal.throwIfAborted();
      }
      return success(url, init);
    });
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run("task-1", controller.signal);
    expect(record.status).toBe("cancelled");
    expect(record.toolCalls).toHaveLength(4);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(record.turnTokenUsage).toHaveLength(4);
    await expect(readFile(join(projectDir, "too-late.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await store.getItem("task-1"))?.status).toBe("pending");
  });

  it("degrades safely when the text summary fails without charging nonexistent summary usage", async () => {
    config.prune = { triggerPairs: 3, retainPairs: 2 };
    script([
      ...Array.from({ length: 4 }, (_, i) => [call(`read-${i}`, "read_file", { path: "target.ts" })]),
      ...scriptFor("after-summary-error.ts"),
    ]);
    const success = globalThis.fetch;
    const fetch = vi.fn(async (url, init) => String(url).endsWith("/chat/completions")
      ? new Response("private summary error", { status: 401 }) : success(url, init));
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(record.tokenUsage).toMatchObject({ input: 8 * 75, output: 8 * 20, cacheReadInput: 8 * 25 });
    expect(record.turnTokenUsage).toHaveLength(8);
    expect(record.toolCalls).toHaveLength(7);
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(record)).not.toContain("private summary error");
  });

  it("re-prompts after a read-only plan so the task can still execute", async () => {
    script([[call("inspect", "read_file", { path: "target.ts" })], [{ ...done, content: [{ type: "output_text", text: "I will write the file next." }] }], ...scriptFor("after-plan.ts")]);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(await readFile(join(projectDir, "after-plan.ts"), "utf8")).toContain("result");
  });

  it("returns tool refusals to the model without changing protected config", async () => {
    const original = await readFile(join(projectDir, ".n-dx.json"), "utf8");
    script([[call("denied", "write_file", { path: ".n-dx.json", content: "{}" })], [done]]);
    const { run: record } = await run();
    expect(record.status).toBe("failed");
    expect(record.toolCalls[0].output).toContain("[GUARD]");
    expect(requests[1].input.find((item: any) => item.type === "function_call_output").output).toContain('"error":');
    expect(await readFile(join(projectDir, ".n-dx.json"), "utf8")).toBe(original);
    expect((await store.getItem("task-2"))?.status).toBe("pending");
  });

  it("cancels an in-flight request and restores only the active task", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort();
      init.signal!.throwIfAborted();
      throw new Error("unreachable");
    }));
    const { run: record } = await run("task-1", controller.signal);
    expect(record.status).toBe("cancelled");
    expect(record.toolCalls).toEqual([]);
    expect((await store.getItem("task-1"))?.status).toBe("pending");
    expect((await store.getItem("task-2"))?.status).toBe("pending");
  });

  it.each([false, true])("cancels a running command on the final turn (another tool queued=%s)", async queuedTool => {
    config.maxTurns = 1;
    const controller = new AbortController();
    script([[
      call("command", "run_command", { command: `node -e "require('fs').writeFileSync('started.txt', 'started');setInterval(()=>{}, 1000)"` }),
      ...(queuedTool ? [call("late", "write_file", { path: "late.txt", content: "must not run" })] : []),
    ]]);
    const running = run("task-1", controller.signal);
    try {
      await vi.waitFor(async () => expect(await readFile(join(projectDir, "started.txt"), "utf8")).toBe("started"));
    } finally {
      controller.abort();
    }
    const { run: record } = await running;
    expect(record.status).toBe("cancelled");
    expect(record.toolCalls).toHaveLength(1);
    const log = await readFile(join(projectDir, ".rex", "execution-log.jsonl"), "utf8");
    expect(log).toContain('"event":"task_cancelled"');
    expect(log).not.toContain('"event":"task_failed"');
    await expect(readFile(join(projectDir, "late.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await store.getItem("task-1"))?.status).toBe("pending");
  });

  it("records authentication failure without CLI fallback or credential disclosure", async () => {
    const fetch = vi.fn(async () => new Response("secret-upstream-body", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const { run: record } = await run();
    expect(record.status).toBe("failed");
    expect(record.error).toContain("authentication");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(record)).not.toMatch(/fixture-key|secret-upstream-body/);
    expect((await store.getItem("task-1"))?.status).toBe("pending");
  });

  it("uses the accepted endpoint and execution effort while preserving the model pin", async () => {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({
      llm: { codex: { api_endpoint: "https://fixture.invalid/v1" }, effort: { "agent.execute": "high" } },
    }));
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://fixture.invalid/v1/responses");
      expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-6-astra", reasoning: { effort: "high" } });
      return response([done]);
    });
    vi.stubGlobal("fetch", fetch);
    config.maxTurns = 1;
    const { run: record } = await run();
    expect(record.diagnostics?.notes).toContain("openai_effort:high");
  });

  it.each(["gpt-unverified", "gpt-6-luna"])("refuses unsupported agent model %s before changing task status or sending requests", async model => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(agentLoop({ config, store, projectDir, henchDir, taskId: "task-1", model })).rejects.toThrow("no verified agent-turn support");
    expect(fetch).not.toHaveBeenCalled();
    expect((await store.getItem("task-1"))?.status).toBe("pending");
  });

  it("applies the post-execution test gate before completing a task", async () => {
    config.skipFullTestGate = false;
    config.testGate = { ...config.testGate, hostSlot: false, command: 'node -e "process.exit(1)"' };
    script(scriptFor("gated.ts"));
    const { run: record } = await run();
    expect(record.status).not.toBe("completed");
    expect(record.error).toMatch(/test|gate/i);
    expect((await store.getItem("task-1"))?.status).toBe("pending");
  });

  it("enforces the USD cap before requesting another turn", async () => {
    config.maxCostUsdPerRun = 0.000001;
    script([[call("read", "read_file", { path: "target.ts" })], [done]]);
    const { run: record } = await run();
    expect(record.status).toBe("budget_exceeded");
    expect(requests).toHaveLength(1);
  });

  it("stops at the token budget before executing returned tools", async () => {
    config.tokenBudget = 50;
    script([[call("write", "write_file", { path: "blocked.ts", content: "no" })]]);
    const { run: record } = await run();
    expect(record.status).toBe("budget_exceeded");
    expect(record.toolCalls).toEqual([]);
    expect(requests).toHaveLength(1);
  });
});
