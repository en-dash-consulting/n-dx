/**
 * Direct route requests with the production registry defaults. Only the
 * vendor connection is replaced; no socket, subprocess or vendor is used.
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dashboardUsagePath } from "../../../src/server/dashboard-usage.js";
import { handleSidecarRoute, type SidecarFramesMessage } from "../../../src/server/routes-sidecar.js";
import { handleTokenUsageRoute, resetAggregationCache } from "../../../src/server/routes-token-usage.js";
import { CHECKPOINT_PROMPT } from "../../../src/server/sidecar/context-refresh.js";
import { appendLedgerEntry } from "../../../src/server/sidecar/ledger.js";
import { SidecarSessionRegistry, worktreeSidecarDir, type SidecarFrame } from "../../../src/server/sidecar/session-registry.js";
import { sidecarCodexSpawn } from "../../../src/server/sidecar/spawn-policy.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

vi.mock("../../../src/server/sidecar/session-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/sidecar/session-registry.js")>();
  return {
    ...actual,
    // Do not supply registryFor or recreate onTurnSpend: defaultRegistryFor
    // must supply every option, including the recorder under test.
    createWorktreeSidecarRegistry: ((projectDir, defaults) => new actual.SidecarSessionRegistry({
      ...defaults,
      ...(throwAfterSpend && { onTurnSpend: (spend) => {
        recorderCalls++;
        defaults?.onTurnSpend?.(spend);
        throw new Error("Fixture recorder failed after append");
      } }),
      dir: actual.worktreeSidecarDir(projectDir),
      connect: (record) => ({
        binary: process.execPath, env: {},
        spawn: scriptedSpawn,
        ...(record.vendor === "codex" && sidecarCodexSpawn(undefined, 60_000, projectDir)),
      }),
    })) satisfies typeof actual.createWorktreeSidecarRegistry,
  };
});

interface ScriptedCall { args: string[]; prompt: string }
let root: string;
let ctx: ServerContext;
let messages: SidecarFramesMessage[];
let calls: ScriptedCall[];
let vendor: "claude" | "codex";
let checkpointing: boolean;
let refuseSpawn: boolean;
let checkpointExit: number;
let throwAfterSpend: boolean;
let recorderCalls: number;
let afterAnswer: (() => void) | undefined;

/** Stream the vendors' usage formats through the real session parser; launch nothing. */
const scriptedSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  const call: ScriptedCall = { args, prompt: "" };
  calls.push(call);
  const ordinal = calls.length;
  if (refuseSpawn && ordinal === 2) throw new Error("Fixture checkpoint spawn refused");
  const child = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null });
  stdin.on("data", (chunk) => { call.prompt += chunk.toString(); });
  stdin.on("finish", () => {
    const checkpoint = call.prompt === CHECKPOINT_PROMPT;
    const measured = checkpointing && ordinal === 1;
    const input = checkpoint ? 50 : measured ? 100 : 10;
    const output = checkpoint ? 3 : measured ? 7 : 4;
    const cacheRead = checkpoint ? 10 : measured ? 20 : 0;
    const cacheCreation = checkpoint ? 5 : measured ? 11 : 0;
    const text = checkpoint ? "Checkpoint reply." : "Delivered answer.";
    const id = `scripted-session-${ordinal}`;
    const frames = vendor === "codex" ? [
      { type: "thread.started", thread_id: id },
      { type: "item.completed", item: { id: `reply-${ordinal}`, type: "agent_message", text } },
      { type: "turn.completed", usage: { input_tokens: input + cacheRead, output_tokens: output, cached_input_tokens: cacheRead } },
    ] : [
      { type: "system", subtype: "init", session_id: id },
      { type: "assistant", message: { id: `reply-${ordinal}`, content: [{ type: "text", text }], usage: {
        input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead,
      } } },
      { type: "result", session_id: id, result: text },
    ];
    for (const frame of frames) stdout.write(JSON.stringify(frame) + "\n");
    stdout.end();
    if (ordinal === 1) afterAnswer?.();
    const exit = checkpoint ? checkpointExit : 0;
    Object.assign(child, { exitCode: exit });
    setImmediate(() => { child.emit("exit", exit, null); child.emit("close", exit, null); });
  });
  return child as ChildProcess;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-route-spend-"));
  mkdirSync(join(root, "codex-home"));
  mkdirSync(join(root, ".codex"));
  vi.stubEnv("CODEX_HOME", join(root, "codex-home"));
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  messages = [];
  calls = [];
  vendor = "claude";
  checkpointing = false;
  refuseSpawn = false;
  checkpointExit = 0;
  throwAfterSpend = false;
  recorderCalls = 0;
  afterAnswer = undefined;
});
afterEach(async () => { resetAggregationCache(); vi.unstubAllEnvs(); await removeTestDir(root); });

async function post(path: string, body: unknown): Promise<{ status: number; body: string }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: "POST", url: `/api/sidecar/sessions${path}`, headers: { "content-type": "application/json" },
  }) as IncomingMessage;
  const response = { status: 0, body: "" };
  const res = {
    writeHead(status: number) { response.status = status; },
    end(text: string) { response.body = text; },
  } as ServerResponse;
  expect(await handleSidecarRoute(req, res, ctx, (message) => { messages.push(message as SidecarFramesMessage); })).toBe(true);
  return response;
}

it("records a posted worktree turn using defaultRegistryFor's spend recorder", async () => {
  const created = await post("", { vendor: "claude", model: "claude-opus-5" });
  expect(created.status).toBe(201);
  const { session } = JSON.parse(created.body) as { session: { id: string; worktree: string } };
  expect(session.worktree).toBe(root);
  expect((await post(`/${session.id}/turns`, { prompt: "Report the fixture usage." })).status).toBe(202);
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ sessionId: session.id, running: false, status: "completed" })));

  // Read the actual project ledger, not a spy on the recorder. Removing the
  // production onTurnSpend option leaves no ledger and must fail here.
  const lines = readFileSync(dashboardUsagePath(root), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines).toEqual([expect.objectContaining({
    command: "sidecar", vendor: "claude", model: "claude-opus-5",
    inputTokens: 10, outputTokens: 4, calls: 1, outcome: "success",
  })]);
});

const cases = (["claude", "codex"] as const).flatMap((vendor) =>
  ["success", "spawn refusal", "ceiling config", "checkpoint exit", ...(vendor === "codex" ? ["project config"] : [])]
    .map((scenario) => ({ vendor, scenario })));

it.each(cases)("keeps $vendor answer spend and cold recovery after checkpoint $scenario", async (testCase) => {
  vendor = testCase.vendor;
  checkpointing = true;
  const { scenario } = testCase;
  const config = join(root, ".n-dx.json");
  const projectConfig = join(root, ".codex", "config.toml");
  const saveCeiling = (ceiling: number) => writeFileSync(config, JSON.stringify({ web: { sidecarContextCeiling: { worktree: ceiling } } }));
  saveCeiling(50);
  refuseSpawn = scenario === "spawn refusal";
  checkpointExit = scenario === "checkpoint exit" ? 1 : 0;
  if (scenario === "ceiling config") afterAnswer = () => writeFileSync(config, "{invalid fixture JSON");
  if (scenario === "project config") afterAnswer = () => writeFileSync(projectConfig, '[mcp_servers.fixture]\ncommand = "unterminated\n');
  const model = vendor === "codex" ? "gpt-6-astra" : "claude-opus-5";
  const created = await post("", { vendor, model });
  expect(created.status).toBe(201);
  const { session: { id } } = JSON.parse(created.body) as { session: { id: string } };
  // Only synthetic, session-local ledger data is carried into the next turn.
  const dir = worktreeSidecarDir(root);
  appendLedgerEntry(dir, id, { at: new Date().toISOString(), type: "decision", text: "Fixture recovery note" });
  expect((await post(`/${id}/turns`, { prompt: "First fixture question" })).status).toBe(202);
  await vi.waitFor(() => expect(messages.some((m) => m.sessionId === id && m.running === false)).toBe(true));

  const usage = () => readFileSync(dashboardUsagePath(root), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  const paidCheckpoint = scenario === "success" || scenario === "checkpoint exit";
  const expected = {
    command: "sidecar", vendor, model, calls: 1, outcome: "success",
    inputTokens: paidCheckpoint ? 150 : 100, outputTokens: paidCheckpoint ? 10 : 7,
    cacheReadTokens: paidCheckpoint ? 30 : 20,
    cacheCreationTokens: vendor === "claude" ? paidCheckpoint ? 16 : 11 : 0,
  };
  // Both assertions matter: a failure must neither relabel the delivered
  // answer nor skip/double the production recorder's append.
  expect(messages.filter((m) => m.running === false)).toEqual([
    expect.objectContaining({ sessionId: id, status: "completed" }),
  ]);
  expect(usage()).toEqual([expect.objectContaining(expected)]);
  const saved = new SidecarSessionRegistry({ dir, connect: () => ({ spawn: scriptedSpawn }) });
  expect(saved.get(id)).toMatchObject({ turns: 1, lastTurn: { status: "completed" }, refresh: { contextTokens: vendor === "claude" ? 131 : 120 } });
  expect(saved.get(id)?.tokens).toEqual({
    input: expected.inputTokens, output: expected.outputTokens,
    cacheReadInput: expected.cacheReadTokens,
    ...(expected.cacheCreationTokens && { cacheCreationInput: expected.cacheCreationTokens }),
  });
  const frames = saved.readFrames(id);
  const diagnostics = frames.filter((f): f is Extract<SidecarFrame, { type: "event" }> =>
    f.type === "event" && !f.checkpoint && f.event.type === "failure");
  if (scenario === "success") {
    expect(diagnostics).toEqual([]);
  } else {
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].event.failure?.message).toMatch(/checkpoint.*next turn.*cold/i);
    if (scenario === "spawn refusal") expect(diagnostics[0].event.failure?.message).toContain("Fixture checkpoint spawn refused");
    if (scenario === "project config") expect(diagnostics[0].event.failure?.message).toContain(projectConfig);
  }
  const attempted = calls.length;
  expect(attempted).toBe(scenario.endsWith("config") ? 1 : 2);
  if (paidCheckpoint) expect(calls[1].prompt).toBe(CHECKPOINT_PROMPT);

  // Repair only disposable configuration, then continue through the same
  // production route: the warm live session must be discarded.
  saveCeiling(1000);
  writeFileSync(projectConfig, "");
  messages = [];
  expect((await post(`/${id}/turns`, { prompt: "Continue the fixture" })).status).toBe(202);
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ running: false, status: "completed" })));
  expect(calls).toHaveLength(attempted + 1);
  const cold = calls.at(-1)!;
  expect(cold.args).not.toContain(vendor === "claude" ? "--resume" : "resume");
  expect(cold.prompt).toContain("This conversation's context was refreshed");
  expect(cold.prompt).toContain("Fixture recovery note");
  expect(cold.prompt).toContain("First fixture question");
  expect(cold.prompt).toContain("Delivered answer.");
  expect(cold.prompt).not.toContain("Checkpoint reply.");
  expect(usage()).toEqual([
    expect.objectContaining(expected),
    expect.objectContaining({ command: "sidecar", vendor, model, calls: 1, outcome: "success", inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheCreationTokens: 0 }),
  ]);
  const recovered = new SidecarSessionRegistry({ dir, connect: () => ({ spawn: scriptedSpawn }) });
  expect(recovered.get(id)?.refresh).toBeUndefined();
  expect(recovered.get(id)?.turns).toBe(2);

  // The production utilization route must see the same measured spend,
  // including cache classes and vendor/model attribution, exactly once.
  resetAggregationCache();
  const response = { status: 0, body: "" };
  const req = { method: "GET", url: "/api/token/utilization" } as IncomingMessage;
  const res = {
    writeHead(status: number) { response.status = status; },
    end(text: string) { response.body = text; },
  } as ServerResponse;
  expect(await handleTokenUsageRoute(req, res, ctx)).toBe(true);
  expect(response.status).toBe(200);
  const totals = {
    inputTokens: expected.inputTokens + 10, outputTokens: expected.outputTokens + 4,
    cacheCreationTokens: expected.cacheCreationTokens, cacheReadTokens: expected.cacheReadTokens, calls: 2,
  };
  expect(JSON.parse(response.body)).toMatchObject({
    usage: { packages: { sidecar: totals } },
    byVendorModel: [{ vendor, model, ...totals, toolBreakdown: { sidecar: totals } }],
  });
});

it("does not retry a spend callback that appended checkpoint usage before throwing", async () => {
  checkpointing = true;
  throwAfterSpend = true;
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ web: { sidecarContextCeiling: { worktree: 50 } } }));
  const created = await post("", { vendor, model: "claude-opus-5" });
  const { session: { id } } = JSON.parse(created.body) as { session: { id: string } };
  expect((await post(`/${id}/turns`, { prompt: "Fixture callback failure" })).status).toBe(202);
  await vi.waitFor(() => expect(messages.some((m) => m.running === false)).toBe(true));
  expect(messages.filter((m) => m.running === false)).toEqual([expect.objectContaining({ status: "completed" })]);
  expect(recorderCalls).toBe(1);
  const lines = readFileSync(dashboardUsagePath(root), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines).toEqual([expect.objectContaining({
    vendor, model: "claude-opus-5", calls: 1, outcome: "success",
    inputTokens: 150, outputTokens: 10, cacheCreationTokens: 16, cacheReadTokens: 30,
  })]);
  const saved = new SidecarSessionRegistry({ dir: worktreeSidecarDir(root), connect: () => ({ spawn: scriptedSpawn }) });
  expect(saved.get(id)?.lastTurn?.status).toBe("completed");
  expect(saved.readFrames(id)).toContainEqual(expect.objectContaining({
    type: "event", event: expect.objectContaining({ type: "failure", failure: expect.objectContaining({ message: expect.stringContaining("Fixture recorder failed after append") }) }),
  }));
});
