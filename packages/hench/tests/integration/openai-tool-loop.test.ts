/** Synthetic Responses transport; real codec, tool guard, store and run finalization. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commitGitFixtureBaseline, disableMemoryGuard } from "../helpers/index.js";
import { initConfig, loadConfig } from "../../src/store/config.js";
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
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(init.body as string);
      requests.push(body);
      if (body.tools.length === 0) return response([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Earlier turns read target.ts; the output file is still to be written." }] }]);
      return response(turns[index++] ?? [done]);
    }));
  }
  const run = (taskId = "task-1", abortSignal?: AbortSignal) => agentLoop({
    config, store, projectDir, henchDir, taskId, model: "gpt-6-astra",
    yes: true, autonomous: true, abortSignal,
  });

  it("completes explicit tasks sequentially through Responses, preserving continuation and disjoint usage", async () => {
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

  it("compacts through Responses and keeps retained tool continuations valid", async () => {
    await writeFile(join(projectDir, ".n-dx.local.json"), JSON.stringify({ llm: { tiers: { codex: { light: "gpt-6.1-sol" } } } }));
    config.prune = { triggerPairs: 3, retainPairs: 2 };
    script([
      ...Array.from({ length: 4 }, (_, i) => [call(`read-${i}`, "read_file", { path: "target.ts" })]),
      ...scriptFor("compacted.ts"),
    ]);
    const { run: record } = await run();
    expect(record.status).toBe("completed");
    expect(requests.some(request => request.tools.length === 0 && request.model === "gpt-6.1-sol")).toBe(true);
    expect(record.tokenUsage.input).toBeGreaterThan(8 * 75);
    expect(record.toolCalls).toHaveLength(7);
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

  it("cancels a running command before executing the next returned tool", async () => {
    const controller = new AbortController();
    script([[
      call("command", "run_command", { command: `node -e "require('fs').writeFileSync('started.txt', 'started');setInterval(()=>{}, 1000)"` }),
      call("late", "write_file", { path: "late.txt", content: "must not run" }),
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

  it("refuses an unsupported pinned model before changing task status or sending requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(agentLoop({ config, store, projectDir, henchDir, taskId: "task-1", model: "gpt-unverified" })).rejects.toThrow("no verified agent-turn support");
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
