/**
 * Approved Sidecar broker calls carry out their effect (story 12).
 *
 * The real route, broker and production actions: an MCP client stands in for
 * the session's vendor CLI, and the only fakes are the two spawn seams
 * (`spawnManaged` for the command job and the run, `exec` for
 * `ndx work --resolve`) and a registry that reports the session's turn running
 * (a real one with a scripted vendor CLI where a test reads the next turn's prompt).
 */

import { execFileSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock, spawnManagedMock } = vi.hoisted(() => ({ execMock: vi.fn(), spawnManagedMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  execMock.mockImplementation(actual.exec);
  return { ...actual, exec: execMock, spawnManaged: spawnManagedMock };
});

import { recordRepoTrust } from "@n-dx/llm-client";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { commandJobsOf, handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { createAnnouncingBroker, handleSidecarRoute, sidecarActions, type SidecarCardMessage } from "../../../src/server/routes-sidecar.js";
import type { SidecarBroker, SidecarCard } from "../../../src/server/sidecar/broker.js";
import { SIDECAR_OUTPUT_MAX_BYTES, outputTail } from "../../../src/server/sidecar/carry-out.js";
import { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { workspaceKeyOf } from "../../../src/server/workspace-scoped.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const SESSION = "s1";

const RESOLUTION = {
  task: { id: "task-1", title: "Carry it out", status: "pending", level: "task", blockedBy: [], claimedBy: null },
  resolved: {
    model: { value: "claude-sonnet-4-6", source: "llm.claude.model" },
    review: { value: true, source: "cli-flag" },
  },
  refusals: [],
  warnings: [{ code: "dirty-tree", message: "The working tree has uncommitted changes" }],
  command: "ndx work --task=task-1 --review .",
};

let root: string;
let ctx: ServerContext;
let server: RouteTestServer;
let broker: SidecarBroker;
let cardMessages: SidecarCardMessage[];
let cardWaiters: Array<(m: SidecarCardMessage) => boolean>;
let finishSpawn: Array<(r: { exitCode: number | null; stdout: string; stderr: string }) => void>;

function broadcast(message: unknown): void {
  const m = message as SidecarCardMessage;
  if (m.type !== "sidecar:card") return;
  cardMessages.push(m);
  cardWaiters = cardWaiters.filter((w) => !w(m));
}

/** The `sidecar:card` announcement with `status`, already sent or still to come. */
function cardAnnounced(status: string): Promise<SidecarCardMessage> {
  const sent = cardMessages.find((m) => m.status === status);
  if (sent) return Promise.resolve(sent);
  return new Promise((resolve) => {
    cardWaiters.push((m) => {
      if (m.status !== status) return false;
      resolve(m);
      return true;
    });
  });
}

/** A session in this worktree whose turn is running, so its broker is served. */
const runningRegistry = (): SidecarSessionRegistry => ({
  get: (id: string) => (id === SESSION ? { id, worktree: root } : undefined),
  isRunning: () => true,
}) as unknown as SidecarSessionRegistry;

async function brokerClient(session = SESSION): Promise<Client> {
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/sidecar/sessions/${session}/mcp`)));
  return client;
}

async function decide(cardId: string, body: Record<string, unknown>, session = SESSION): Promise<Response> {
  return fetch(`${server.baseUrl}/api/sidecar/sessions/${session}/cards/${cardId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

/** The args of every spawn, `ndx`'s resolved prefix dropped. */
function spawnedArgs(): string[][] {
  return spawnManagedMock.mock.calls.map(([, args]) => args as string[]);
}

beforeEach(() => {
  resetHenchRouteStateForTests();
  spawnManagedMock.mockReset();
  finishSpawn = [];
  spawnManagedMock.mockImplementation(() => ({
    done: new Promise((resolve) => { finishSpawn.push(resolve); }),
    kill: vi.fn(() => true),
    pid: 4242,
  }));
  execMock.mockClear();
  cardMessages = [];
  cardWaiters = [];

  root = mkdtempSync(join(tmpdir(), "sidecar-carry-out-"));
  mkdirSync(join(root, ".rex", ".cache"), { recursive: true });
  mkdirSync(join(root, ".hench", "runs"), { recursive: true });
  mkdirSync(join(root, ".hench", "sidecar"), { recursive: true });
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
  writeFileSync(join(root, ".rex", ".cache", "prd.json"), JSON.stringify({
    schema: "rex/v1",
    title: "carry out",
    items: [
      { id: "task-1", title: "Carry it out", status: "pending", level: "task" },
      { id: "task-2", title: "And this", status: "pending", level: "task" },
    ],
  }));
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  broker = createAnnouncingBroker(join(root, ".hench", "sidecar"), broadcast);
});

afterEach(async () => {
  for (const finish of finishSpawn) finish({ exitCode: 0, stdout: "", stderr: "" });
  await server?.close();
  await removeTestDir(root);
});

/** How long a command's tool result waits on the job; a test that reaches the bound shortens it. */
let commandWaitMs: number;

/** Serve the route over {@link runningRegistry}; takes no argument, so `beforeEach(serve)` passes it none. */
function serve(): Promise<void> {
  return serveWith(runningRegistry);
}

async function serveWith(registryFor: () => SidecarSessionRegistry): Promise<void> {
  commandWaitMs = 10_000;
  server = await startRouteTestServer(async (req, res) =>
    (await handleSidecarRoute(req, res, ctx, broadcast, {
      registryFor,
      brokerFor: () => broker,
      // A run's starting phase cut short: a start_work result waits it out.
      actionsFor: (c) => sidecarActions(c, broadcast, { commandWaitMs, startingPhaseMs: 20 }),
    }))
    || handleCommandsRoute(req, res, ctx, broadcast));
}

/** Resolves once the command job has spawned. */
async function spawned(count = 1): Promise<void> {
  await vi.waitFor(() => expect(finishSpawn).toHaveLength(count));
}

async function sidecarCommandStatus(): Promise<Record<string, unknown>> {
  return (await fetch(`${server.baseUrl}/api/commands/sidecar-command/status`)).json() as Promise<Record<string, unknown>>;
}

describe("run_command", () => {
  beforeEach(serve);

  it("raises a card and runs nothing until the operator approves it", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "status", "."] } });
    const { cardId } = await cardAnnounced("pending");
    expect(spawnManagedMock).not.toHaveBeenCalled();

    expect((await decide(cardId, { decision: "approve" })).status).toBe(200);
    await spawned();
    expect(spawnedArgs()[0].slice(-2)).toEqual(["status", "."]);

    // While it runs, the job tray reads the status route; Live reads commandJobsOf.
    const status = await sidecarCommandStatus();
    expect(status).toMatchObject({ running: true, command: "ndx status ." });
    expect(commandJobsOf(workspaceKeyOf(ctx))).toEqual([
      expect.objectContaining({ kind: "sidecar-command", running: true, detail: "ndx status ." }),
    ]);

    finishSpawn[0]({ exitCode: 0, stdout: "PRD: 3 of 5 tasks done\n", stderr: "" });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toBe(
      `The operator approved card ${cardId}. \`ndx status .\` (job ${String(status.jobId)}) exited with code 0.\nOutput:\nPRD: 3 of 5 tasks done`,
    );
    await client.close();
  });

  it("returns a failed command's non-zero exit status and its output, stderr included", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["git", "show", "nope"] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    await spawned();
    finishSpawn[0]({ exitCode: 128, stdout: "", stderr: "fatal: bad revision 'nope'\n" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/`git show nope` \(job sidecar-command-\w+\) exited with code 128\.\nOutput:\nfatal: bad revision 'nope'$/);
    await client.close();
  });

  it("cuts long output to its last lines and says how much was cut", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["git", "log"] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    await spawned();
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    finishSpawn[0]({ exitCode: 0, stdout: lines.join("\n"), stderr: "" });
    const text = resultText(await call);
    const cutBytes = Buffer.byteLength(lines.slice(0, 120).join("\n")) + 1;
    expect(text).toContain(`Output, cut to its end (120 lines, ${cutBytes} bytes cut before it):\nline 121\n`);
    expect(text.endsWith("\nline 200")).toBe(true);
    expect(text).not.toContain("line 120\n");
    await client.close();
  });

  it("answers that a command still running at the bound carries on as its job", async () => {
    commandWaitMs = 50;
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    const result = await call;
    const status = await sidecarCommandStatus();
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toMatch(new RegExp(`\`ndx ci \\.\` is still running as job ${String(status.jobId)}; output in the job tray and on Live\\.$`));
    expect(status).toMatchObject({ running: true, command: "ndx ci ." });
    expect(commandJobsOf(workspaceKeyOf(ctx))).toEqual([expect.objectContaining({ kind: "sidecar-command", running: true })]);
    await client.close();
  });

  it("answers at once when the turn stops while the command runs, and leaves the job running", async () => {
    // Past the test timeout: only the stopped turn can end this wait in time.
    commandWaitMs = 600_000;
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    await spawned();
    broker.withdraw(SESSION, "The operator stopped the turn");
    const result = await call;
    expect(resultText(result)).toMatch(/`ndx ci \.` is still running as job sidecar-command-\w+; output in the job tray and on Live\.$/);
    const child = spawnManagedMock.mock.results[0].value as { kill: ReturnType<typeof vi.fn> };
    expect(child.kill).not.toHaveBeenCalled();
    expect(await sidecarCommandStatus()).toMatchObject({ running: true });
    await client.close();
  });

  it("says so when Stop in the job tray ends the command", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    await spawned();
    expect((await fetch(`${server.baseUrl}/api/commands/sidecar-command/stop`, { method: "POST" })).status).toBe(200);
    finishSpawn[0]({ exitCode: null, stdout: "partial\n", stderr: "" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/was stopped from the job tray\.\nOutput:\npartial$/);
    await client.close();
  });

  it("runs an allow-listed command without a card", async () => {
    const argv = ["git", "log", "--oneline", "-5"];
    writeFileSync(join(root, ".hench", "sidecar", "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [{ tool: "run_command", key: JSON.stringify(argv) }],
    }));
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv } });
    await spawned();
    expect(broker.cards(SESSION)).toEqual([]);
    expect(spawnManagedMock.mock.calls[0].slice(0, 2)).toEqual(["git", ["log", "--oneline", "-5"]]);
    finishSpawn[0]({ exitCode: 0, stdout: "abc123 one\n", stderr: "" });
    expect(resultText(await call)).toMatch(/^Allowed by the Sidecar allow-list\. `git log --oneline -5` \(job sidecar-command-\w+\) exited with code 0\./);
    await client.close();
  });

  it("runs nothing when the card is denied, and says so", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "deny", reason: "not now" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(`The operator denied card ${cardId}. Nothing ran. Operator's note: not now`);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("runs nothing when the card is withdrawn, and says so", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await cardAnnounced("pending");
    broker.withdraw(SESSION, "The operator stopped the turn");
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/was withdrawn: The operator stopped the turn\. Nothing ran\.$/);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("ends the job failed when the spawn throws, so the next command can run", async () => {
    spawnManagedMock.mockImplementationOnce(() => {
      throw new TypeError("The argument 'args[1]' must be a string without null bytes");
    });
    const client = await brokerClient();
    const bad = client.callTool({ name: "run_command", arguments: { argv: ["git", "log", "a\u0000b"] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    const result = await bad;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Nothing ran: the command could not be started: .*null bytes/);
    const status = await (await fetch(`${server.baseUrl}/api/commands/sidecar-command/status`)).json();
    expect(status).toMatchObject({ running: false, error: expect.stringMatching(/null bytes/) });

    cardMessages = [];
    const next = client.callTool({ name: "run_command", arguments: { argv: ["git", "status"] } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    await spawned();
    finishSpawn[0]({ exitCode: 0, stdout: "", stderr: "" });
    expect(resultText(await next)).toMatch(/`git status` \(job sidecar-command-\w+\) exited with code 0\.\nIt printed nothing\.$/);
    await client.close();
  });

  it("refuses a program other than ndx and git, running nothing", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["rm", "-rf", "."] } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Nothing ran: Sidecar runs ndx and git commands only, not "rm"\.$/);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });
});

describe("start_work", () => {
  beforeEach(async () => {
    execMock.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes("--resolve")
        ? { exitCode: 0, stdout: JSON.stringify(RESOLUTION), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "unexpected exec in test" });
    await serve();
  });

  it("shows the run's ndx work --resolve on the card before approval, then starts it through the execute route", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1", options: { review: true } } });
    const { cardId } = await cardAnnounced("pending");

    const resolveArgs = execMock.mock.calls.map(([, args]) => args as string[]).find((a) => a.includes("--resolve"))!;
    expect(resolveArgs).toEqual(expect.arrayContaining(["work", "--task=task-1", "--resolve", "--review", root]));
    const [card] = broker.cards(SESSION) as SidecarCard[];
    expect(card).toMatchObject({ id: cardId, kind: "work", status: "pending" });
    expect(card.preview).toBe([
      "ndx work --task=task-1 --review .",
      "Task: Carry it out (pending)",
      'model = "claude-sonnet-4-6" (from llm.claude.model)',
      "review = true (from cli-flag)",
      "Warnings:",
      "- dirty-tree: The working tree has uncommitted changes",
      "Active runs: 0 of 3",
    ].join("\n"));
    expect(spawnManagedMock).not.toHaveBeenCalled();

    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(spawnedArgs()).toHaveLength(1);
    expect(spawnedArgs()[0]).toEqual(expect.arrayContaining(["work", "--task=task-1", "--review", "--require-unblocked"]));
    expect(resultText(result)).toMatch(/^The operator approved card \S+\. Started run exec-\w+ on task task-1 \(Carry it out\)/);
    await client.close();
  });

  it("reports the execute route's refusal and starts nothing", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "missing" } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Nothing started: Task "missing" not found in PRD\.$/);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("reports a start hench refuses in its starting phase as failed, with hench's message, on the result and the card", async () => {
    spawnManagedMock.mockImplementationOnce(() => ({
      done: Promise.resolve({
        exitCode: 1,
        stdout: "Checking the working tree…\n",
        stderr: "Refusing to start: the working tree has uncommitted changes:\n  src/app.ts\n",
      }),
      kill: vi.fn(() => true),
      pid: 4242,
    }));
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(
      /Run exec-\w+ on task task-1 \(Carry it out\) did not start: it exited with code 1\.\nRefusing to start: the working tree has uncommitted changes:\n {2}src\/app\.ts\nChecking the working tree…$/,
    );
    expect(resultText(result)).not.toContain("Started run");
    expect(broker.cards(SESSION).find((c) => c.id === cardId)?.carriedOut).toEqual({ ok: false });
    await client.close();
  });

  // #989 review: hench refuses on stdout (info) and warns on stderr (warn).
  it("carries hench's stdout refusal, with its file list, when stderr holds only a warning", async () => {
    spawnManagedMock.mockImplementationOnce(() => ({
      done: Promise.resolve({
        exitCode: 1,
        stdout: "Refusing to start: the working tree has uncommitted changes:\n  src/app.ts\n  src/lib.ts\n",
        stderr: "Warning: hench config field \"maxTurn\" is unknown and ignored\n",
      }),
      kill: vi.fn(() => true),
      pid: 4243,
    }));
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(
      /did not start: it exited with code 1\.\nWarning: hench config field "maxTurn" is unknown and ignored\nRefusing to start: the working tree has uncommitted changes:\n {2}src\/app\.ts\n {2}src\/lib\.ts$/,
    );
    // The card's line shows this result text beside its failed state.
    expect(broker.cards(SESSION).find((c) => c.id === cardId)?.carriedOut).toEqual({ ok: false });
    await client.close();
  });

  it("revises a started run's card to failed when the run fails later", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" });
    expect(resultText(await call)).toMatch(/Started run exec-\w+ on task task-1/);
    const card = () => broker.cards(SESSION).find((c) => c.id === cardId);
    expect(card()?.carriedOut).toEqual({ ok: true });

    cardMessages = [];
    finishSpawn[0]({ exitCode: 1, stdout: "Stopping after 1 iteration(s) due to failed status.\n", stderr: "" });
    await cardAnnounced("approved");
    expect(card()?.carriedOut).toEqual({ ok: false });
    await client.close();
  });
});

describe("a run that fails after start_work said it started", () => {
  /** Each prompt the session's vendor CLI read on stdin, in order. */
  let prompts: string[];
  let registry: SidecarSessionRegistry;
  let sessionId: string;
  /** The agent's start_work call runs inside a turn: the broker is served while this holds. */
  let turnHeld: boolean;

  /** A Claude stand-in that records its prompt and replies "ok". */
  const scriptedClaude: NonNullable<VendorSessionOptions["spawn"]> = () => {
    const id = `vendor-${prompts.length + 1}`;
    const index = prompts.push("") - 1;
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined });
    stdin.on("data", (chunk: Buffer) => { prompts[index] += chunk.toString(); });
    stdin.on("end", () => {
      stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: id }) + "\n");
      stdout.write(JSON.stringify({ type: "result", session_id: id, result: "ok" }) + "\n");
      stdout.end();
      setImmediate(() => child.emit("close", 0));
    });
    return child as unknown as ChildProcess;
  };

  beforeEach(async () => {
    execMock.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes("--resolve")
        ? { exitCode: 0, stdout: JSON.stringify(RESOLUTION), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "unexpected exec in test" });
    prompts = [];
    turnHeld = true;
    registry = new SidecarSessionRegistry({ dir: join(root, ".hench", "sidecar"), connect: () => ({ spawn: scriptedClaude }) });
    sessionId = registry.create({ scope: "worktree", worktree: root, vendor: "claude" }).id;
    const isRunning = registry.isRunning.bind(registry);
    vi.spyOn(registry, "isRunning").mockImplementation((id) => turnHeld || isRunning(id));
    await serveWith(() => registry);
  });

  async function turn(prompt: string): Promise<void> {
    const sent = prompts.length;
    const res = await fetch(`${server.baseUrl}/api/sidecar/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(prompts).toHaveLength(sent + 1);
      expect(registry.isRunning(sessionId)).toBe(false);
    });
  }

  it("tells the agent on the session's next turn which run failed, with the end of hench's output", async () => {
    const client = await brokerClient(sessionId);
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" }, sessionId);
    const started = resultText(await call);
    expect(started).toMatch(/Started run exec-\w+ on task task-1/);
    const runId = /Started run (exec-\w+)/.exec(started)![1];
    await client.close();

    // Past its starting phase, hench refuses the run.
    cardMessages = [];
    finishSpawn[0]({ exitCode: 1, stdout: "", stderr: "Refusing to start: the working tree has uncommitted changes:\n  src/app.ts\n" });
    await cardAnnounced("approved");
    turnHeld = false;

    await turn("what next?");
    expect(prompts[0]).toBe([
      "## Since your last turn",
      `Run ${runId} on task task-1 (Carry it out) failed: it exited with code 1.`,
      "Refusing to start: the working tree has uncommitted changes:",
      "  src/app.ts",
      "",
      "## Operator's message",
      "what next?",
    ].join("\n"));

    // Carried once: the turn after it reads the operator's message alone.
    await turn("and then?");
    expect(prompts[1]).toBe("and then?");
  });
});

describe("start_work over an unfinished blocker", () => {
  beforeEach(async () => {
    // The resolved command echoes the flags it was asked for, as hench's does.
    execMock.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes("--resolve")
        ? {
          exitCode: 0,
          stdout: JSON.stringify({ ...RESOLUTION, command: `ndx work --task=task-2${args.includes("--require-unblocked") ? " --require-unblocked" : ""} .` }),
          stderr: "",
        }
        : { exitCode: 1, stdout: "", stderr: "unexpected exec in test" });
    writeFileSync(join(root, ".rex", ".cache", "prd.json"), JSON.stringify({
      schema: "rex/v1",
      title: "blocked",
      items: [
        { id: "task-1", title: "Carry it out", status: "pending", level: "task" },
        { id: "task-2", title: "And this", status: "pending", level: "task", blockedBy: ["task-1"] },
      ],
    }));
    await serve();
  });

  it("starts nothing when the call passes no options, names the blocker, and the card's command carries --require-unblocked", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-2" } });
    const { cardId } = await cardAnnounced("pending");
    const preview = broker.cards(SESSION).find((c) => c.id === cardId)!.preview!;
    expect(preview.split("\n")[0]).toBe("ndx work --task=task-2 --require-unblocked .");
    expect(preview).toContain("- Carry it out (task-1, pending)");

    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Nothing started: Task is waiting on unfinished work: "Carry it out" (task-1, pending).');
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("starts the task when the call passes requireUnblocked: false, and neither the card nor the run carries the flag", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "start_work", arguments: { taskId: "task-2", options: { requireUnblocked: false } } });
    const { cardId } = await cardAnnounced("pending");
    const preview = broker.cards(SESSION).find((c) => c.id === cardId)!.preview!;
    expect(preview.split("\n")[0]).toBe("ndx work --task=task-2 .");
    expect(preview).not.toContain("--require-unblocked");

    await decide(cardId, { decision: "approve" });
    expect(resultText(await call)).toMatch(/Started run exec-\w+ on task task-2/);
    expect(spawnedArgs()).toHaveLength(1);
    expect(spawnedArgs()[0]).not.toContain("--require-unblocked");
    await client.close();
  });
});

describe("work card run slots", () => {
  beforeEach(async () => {
    execMock.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes("--resolve")
        ? { exitCode: 0, stdout: JSON.stringify(RESOLUTION), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "unexpected exec in test" });
    writeFileSync(join(root, ".rex", ".cache", "prd.json"), JSON.stringify({
      schema: "rex/v1",
      title: "slots",
      items: [1, 2, 3, 4].map((n) => ({ id: `task-${n}`, title: `Task ${n}`, status: "pending", level: "task" })),
    }));
    await serve();
  });

  it("shows active runs, and refuses a second start while the first still runs in this checkout", async () => {
    const client = await brokerClient();
    const first = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const firstCard = await cardAnnounced("pending");
    expect(broker.cards(SESSION).find((c) => c.id === firstCard.cardId)?.preview).toMatch(/\nActive runs: 0 of 3$/);
    await decide(firstCard.cardId, { decision: "approve" });
    expect(resultText(await first)).toMatch(/Started run exec-\w+ on task task-1/);

    cardMessages = [];
    const second = client.callTool({ name: "start_work", arguments: { taskId: "task-2" } });
    const { cardId } = await cardAnnounced("pending");
    const preview = broker.cards(SESSION).find((c) => c.id === cardId)!.preview!;
    expect(preview).toMatch(/\nActive runs: 1 of 3\nApproving now starts nothing: task task-1 is already running in this checkout, and two runs in one checkout collide/);
    await decide(cardId, { decision: "approve" });
    const result = await second;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Nothing started: task task-1 is already running in this checkout/);
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
    await client.close();
  });

  describe("with runs in a second worktree of the repository", () => {
    let sibling: string;
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });

    beforeEach(() => {
      git(root, "init", "-q");
      git(root, "commit", "-q", "--allow-empty", "-m", "init");
      sibling = join(root, "..", `${basename(root)}-sibling`);
      git(root, "worktree", "add", "-q", sibling);
    });
    afterEach(async () => { await removeTestDir(sibling); });

    /** A lock held by this live process, as hench's limiter writes it, in `dir`'s worktree. */
    function holdLock(dir: string, taskId: string, name: string): void {
      mkdirSync(join(dir, ".hench", "locks"), { recursive: true });
      writeFileSync(join(dir, ".hench", "locks", `${name}.lock`), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId }));
    }

    it("counts the run on the work card, as the queue planner counts live locks in every worktree", async () => {
      holdLock(sibling, "elsewhere-1", "a");
      const client = await brokerClient();
      const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
      const { cardId } = await cardAnnounced("pending");
      expect(broker.cards(SESSION).find((c) => c.id === cardId)?.preview).toMatch(/\nActive runs: 1 of 3$/);
      await decide(cardId, { decision: "deny" });
      await call;
      await client.close();
    });

    it("refuses a start while a run is live in this checkout, naming it, on the card and on approval; a run only in the sibling does not", async () => {
      holdLock(root, "here-1", "h");
      const client = await brokerClient();
      const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
      const { cardId } = await cardAnnounced("pending");
      expect(broker.cards(SESSION).find((c) => c.id === cardId)?.preview).toMatch(/\nActive runs: 1 of 3\nApproving now starts nothing: task here-1 is already running in this checkout/);
      await decide(cardId, { decision: "approve" });
      const result = await call;
      expect(result.isError).toBe(true);
      expect(resultText(result)).toMatch(/Nothing started: task here-1 is already running in this checkout/);
      expect(spawnManagedMock).not.toHaveBeenCalled();
      await removeTestDir(join(root, ".hench", "locks"));

      cardMessages = [];
      holdLock(sibling, "elsewhere-1", "a");
      const other = client.callTool({ name: "start_work", arguments: { taskId: "task-2" } });
      const next = await cardAnnounced("pending");
      expect(broker.cards(SESSION).find((c) => c.id === next.cardId)?.preview).toMatch(/\nActive runs: 1 of 3$/);
      await decide(next.cardId, { decision: "approve" });
      expect(resultText(await other)).toMatch(/Started run exec-\w+ on task task-2/);
      await client.close();
    });

    it("starts nothing when the repository has three live runs, and names the runs that hold the limit", async () => {
      holdLock(sibling, "elsewhere-1", "a");
      holdLock(sibling, "elsewhere-2", "b");
      holdLock(sibling, "elsewhere-3", "c");
      const client = await brokerClient();
      const call = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
      const { cardId } = await cardAnnounced("pending");
      const preview = broker.cards(SESSION).find((c) => c.id === cardId)!.preview!;
      expect(preview).toMatch(/\nActive runs: 3 of 3 \(the limit: approving now starts nothing, the concurrent run limit is reached/);
      await decide(cardId, { decision: "approve" });
      const result = await call;
      expect(result.isError).toBe(true);
      const text = resultText(result);
      expect(text).toMatch(/Nothing started: the concurrent run limit is reached \(3 of 3 runs across the repository, guard\.maxConcurrentProcesses\)/);
      for (const id of ["elsewhere-1", "elsewhere-2", "elsewhere-3"]) expect(text).toContain(`task ${id}`);
      expect(text).toContain(basename(sibling));
      expect(spawnManagedMock).not.toHaveBeenCalled();
      await client.close();
    });
  });
});

describe("propose_run_plan", () => {
  const PLAN = {
    lanes: [
      {
        command: "ndx work --task=task-1 --auto . && ndx work --task=task-2 --auto .",
        changeId: "change-a",
        tasks: [
          { id: "task-1", title: "Carry it out", reason: "ready; first in its change" },
          { id: "task-2", title: "And this", reason: "follows task-1" },
        ],
      },
      { command: "ndx work --task=task-3 --auto .", changeId: "change-b", tasks: [{ id: "task-3", title: "Elsewhere", reason: "ready" }] },
    ],
    excluded: [],
    activeRuns: 1,
    runLimit: 3,
    summary: "2 lanes from 3 ready tasks.",
  };
  let plan: unknown;

  beforeEach(async () => {
    plan = PLAN;
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" }, features: { hench: { readyNext: true } } }));
    execMock.mockImplementation(async (_bin: string, args: string[]) =>
      args.includes("--plan-queue")
        ? { launched: true, exitCode: 0, stdout: JSON.stringify(plan), stderr: "" }
        : args.includes("--resolve")
          ? { exitCode: 0, stdout: JSON.stringify(RESOLUTION), stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "unexpected exec in test" });
    await serve();
  });

  const planSpawns = (): number => execMock.mock.calls.filter(([, args]) => (args as string[]).includes("--plan-queue")).length;

  it("raises a run-plan card of the planner's lanes with their exact commands, and starts nothing", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: { note: "Two lanes can run side by side." } });
    const { cardId } = await cardAnnounced("pending");

    const card = broker.cards(SESSION).find((c) => c.id === cardId)!;
    expect(card).toMatchObject({ kind: "run-plan", tool: "propose_run_plan", allowListKey: null, status: "pending", runPlan: PLAN });
    expect(card.runPlan!.lanes.map((l) => l.command)).toEqual([
      "ndx work --task=task-1 --auto . && ndx work --task=task-2 --auto .",
      "ndx work --task=task-3 --auto .",
    ]);
    expect(planSpawns()).toBe(1);
    expect(spawnManagedMock).not.toHaveBeenCalled();

    // Not now: nothing started, and the agent is told so.
    await decide(cardId, { decision: "deny" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(`The operator denied card ${cardId}. Nothing ran.`);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("Start lane names the lane's first task alone, lists the rest with their commands, and starts nothing until a work card is approved", async () => {
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: {} });
    const { cardId } = await cardAnnounced("pending");
    expect((await decide(cardId, { decision: "approve" })).status).toBe(400);
    expect((await decide(cardId, { decision: "approve", lane: 7 })).status).toBe(400);
    expect((await decide(cardId, { decision: "approve", lane: 0 })).status).toBe(200);

    const result = await call;
    expect(result.isError).toBeFalsy();
    const text = resultText(result);
    expect(text).toContain("The operator chose lane 1 (change change-a). Nothing has started. Call start_work for its first task only: task-1 Carry it out (`ndx work --task=task-1 --auto .`).");
    expect(text).toContain("Its other tasks wait, in order: task-2 And this: ndx work --task=task-2 --auto .");
    expect(text).toContain("raise the next start_work card in a later turn");
    expect(text).not.toContain("task-3");
    expect(spawnManagedMock).not.toHaveBeenCalled();

    // The agent's next call is a work card for that task; the plan itself never started a run.
    cardMessages = [];
    const start = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    const work = await cardAnnounced("pending");
    expect(broker.cards(SESSION).find((c) => c.id === work.cardId)).toMatchObject({ kind: "work", input: { taskId: "task-1" } });
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await decide(work.cardId, { decision: "approve" });
    expect(resultText(await start)).toMatch(/Started run exec-\w+ on task task-1/);
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("starts a first step that carries --require-unblocked, naming the equivalent start_work option", async () => {
    plan = { ...PLAN, lanes: [{ ...PLAN.lanes[0], command: "ndx work --task=task-1 --require-unblocked --auto . && ndx work --task=task-2 --auto ." }] };
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: {} });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve", lane: 0 });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain(
      'Call start_work for its first task only: task-1 Carry it out (`ndx work --task=task-1 --require-unblocked --auto .`) — start_work options {"requireUnblocked":true}.',
    );

    // Its blockers are all completed (it has none), so the guarded work card starts it.
    cardMessages = [];
    const start = client.callTool({ name: "start_work", arguments: { taskId: "task-1", options: { requireUnblocked: true } } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    expect(resultText(await start)).toMatch(/Started run exec-\w+ on task task-1/);
    expect(spawnedArgs()[0]).toContain("--require-unblocked");
    await client.close();
  });

  it("refuses a lane's later task whose in-lane blocker has not completed, naming the blocker on the card and in the result", async () => {
    plan = { ...PLAN, lanes: [{ ...PLAN.lanes[0], command: "ndx work --task=task-1 --auto . && ndx work --task=task-2 --require-unblocked --auto ." }] };
    // task-1's run ended without completing it: task-2 still waits on it.
    writeFileSync(join(root, ".rex", ".cache", "prd.json"), JSON.stringify({
      schema: "rex/v1",
      title: "carry out",
      items: [
        { id: "task-1", title: "Carry it out", status: "pending", level: "task" },
        { id: "task-2", title: "And this", status: "pending", level: "task", blockedBy: ["task-1"] },
      ],
    }));
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: {} });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve", lane: 0 });
    expect(resultText(await call)).toContain(
      'Its other tasks wait, in order: task-2 And this: ndx work --task=task-2 --require-unblocked --auto . — start_work options {"requireUnblocked":true}.',
    );

    cardMessages = [];
    const start = client.callTool({ name: "start_work", arguments: { taskId: "task-2", options: { requireUnblocked: true } } });
    const { cardId } = await cardAnnounced("pending");
    const card = broker.cards(SESSION).find((c) => c.id === cardId)!;
    expect(card.preview).toContain("Waiting on unfinished blockers:\n- Carry it out (task-1, pending)");
    await decide(cardId, { decision: "approve" });
    const result = await start;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('Nothing started: Task is waiting on unfinished work: "Carry it out" (task-1, pending).');
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("will not start a lane that must run in its own worktree, and tells the agent to have the operator run it from a terminal", async () => {
    plan = { ...PLAN, lanes: [PLAN.lanes[0], { ...PLAN.lanes[1], ownWorktree: true }] };
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: {} });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve", lane: 1 });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("must run in a worktree of its own");
    expect(resultText(result)).toContain("from a terminal in a worktree of its own");
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("will not start a lane whose first step carries a flag no run option carries", async () => {
    plan = { ...PLAN, lanes: [{ ...PLAN.lanes[0], command: "ndx work --task=task-1 --mine --auto . && ndx work --task=task-2 --auto ." }] };
    const client = await brokerClient();
    const call = client.callTool({ name: "propose_run_plan", arguments: {} });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve", lane: 0 });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("carries --mine and a work card cannot. Nothing started");
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("raises no card when the planner has no lane", async () => {
    plan = { lanes: [], excluded: [], activeRuns: 0, runLimit: 3, summary: "Nothing is ready." };
    const client = await brokerClient();
    const result = await client.callTool({ name: "propose_run_plan", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("No card was raised: the planner has no lane (Nothing is ready.). Nothing started.");
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("raises no card, and spawns no planner, while hench.readyNext is off", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    const client = await brokerClient();
    const result = await client.callTool({ name: "propose_run_plan", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("No card was raised: the hench.readyNext feature is off. Nothing started.");
    expect(planSpawns()).toBe(0);
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("raises no card when the planner fails", async () => {
    execMock.mockImplementation(async () => ({ launched: true, exitCode: 2, stdout: "", stderr: "boom" }));
    const client = await brokerClient();
    const result = await client.callTool({ name: "propose_run_plan", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/^No card was raised: '[\w-]+ work --plan-queue' did not complete: boom\. Nothing started\.$/);
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });
});

describe("tools carried out by a later batch", () => {
  beforeEach(serve);

  it.each([
    ["propose_edit", { path: "a.ts", diff: "-a\n+b" }, "a later batch"],
    ["migration_decision", { entries: [{ id: "x" }] }, "G1"],
  ])("an approved %s reports it is recorded, not carried out yet, and names %s", async (tool, args, batch) => {
    const client = await brokerClient();
    const call = client.callTool({ name: tool, arguments: args });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain(`approved card ${cardId}`);
    expect(resultText(result)).toContain(`Recorded, not carried out yet: ${batch}`);
    expect(spawnManagedMock).not.toHaveBeenCalled();
    await client.close();
  });
});

describe("github_read and draft_github_post", () => {
  beforeEach(serve);
  // These tests answer gh with stubs; later tests get the real exec back.
  let realExec: ReturnType<typeof execMock.getMockImplementation>;
  beforeEach(() => { realExec = execMock.getMockImplementation(); });
  afterEach(() => { if (realExec) execMock.mockImplementation(realExec); });

  /** gh calls, as the llm-client exec saw them: args and the text sent on stdin. */
  const ghCalls = (): Array<{ args: string[]; input?: string }> =>
    execMock.mock.calls
      .filter(([cmd]) => cmd === "gh")
      .map(([, args, opts]) => ({ args: args as string[], input: (opts as { input?: string }).input }));

  /** The allowance in the user's own local config, or with `file` in the repository's shared config. */
  function githubReads(on: boolean, file = ".n-dx.local.json"): void {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    writeFileSync(join(root, file), JSON.stringify({ ...(file === ".n-dx.json" ? { llm: { vendor: "claude" } } : {}), web: { sidecarGithubReads: on } }));
  }

  /** gh answers the check run; git names `origin/<defaultRef>` as origin's default branch. */
  function answerCheckRuns(conclusion: string, defaultBranch = "main"): void {
    execMock.mockImplementation(async (cmd: string) => {
      if (cmd === "gh") {
        return { launched: true, error: null, exitCode: 0, stderr: "", stdout: JSON.stringify({ check_runs: [{ conclusion, status: "completed", head_sha: "abcdef0123456", html_url: "https://github.com/o/r/runs/1" }] }) };
      }
      return cmd === "git"
        ? { launched: true, error: null, exitCode: 0, stderr: "", stdout: `origin/${defaultBranch}\n` }
        : { launched: true, error: null, exitCode: 1, stdout: "", stderr: "not here" };
    });
  }

  /** Turns `git.branchHealth` on in the project config; call after `githubReads`, which rewrites that file. */
  function branchHealth(on: boolean): void {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" }, features: { git: { branchHealth: on } } }));
  }

  it("raises a network-read card while web.sidecarGithubReads is off, and reads nothing until it is approved", async () => {
    githubReads(false);
    answerCheckRuns("failure");
    const client = await brokerClient();
    const call = client.callTool({ name: "github_read", arguments: { kind: "check", ref: "test (ubuntu)", base: "main" } });
    const { cardId } = await cardAnnounced("pending");
    expect(broker.cards(SESSION)[0]).toMatchObject({ kind: "network-read", allowListKey: null });
    expect(ghCalls()).toEqual([]);

    await decide(cardId, { decision: "approve" });
    const text = resultText(await call);
    expect(text).toContain(`approved card ${cardId}`);
    expect(text).toContain("failing on main too. Class: failing on main.");
    expect(ghCalls()[0].args).toEqual(["api", "repos/{owner}/{repo}/commits/main/check-runs?check_name=test%20(ubuntu)&per_page=1"]);
    await client.close();
  });

  it("reads at once, with no card, while web.sidecarGithubReads is on, and keeps the packet's class when main passes", async () => {
    githubReads(true);
    answerCheckRuns("success");
    const client = await brokerClient();
    const text = resultText(await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "main" } }));
    expect(text).toContain("Allowed for this project by web.sidecarGithubReads.");
    expect(text).toContain("it is not failing on main");
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("still raises a network-read card when only the untrusted repository's .n-dx.json turns reads on", async () => {
    githubReads(true, ".n-dx.json");
    answerCheckRuns("failure");
    const client = await brokerClient();
    const call = client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "main" } });
    const { cardId } = await cardAnnounced("pending");
    expect(broker.cards(SESSION)[0]).toMatchObject({ kind: "network-read" });
    expect(ghCalls()).toEqual([]);
    await decide(cardId, { decision: "deny" });
    expect(resultText(await call)).toContain("Nothing ran.");
    expect(ghCalls()).toEqual([]);
    await client.close();
  });

  it("reads at once under the repository's .n-dx.json once the checkout is trusted", async () => {
    githubReads(true, ".n-dx.json");
    recordRepoTrust(root);
    answerCheckRuns("success");
    const client = await brokerClient();
    const text = resultText(await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "main" } }));
    expect(text).toContain("Allowed for this project by web.sidecarGithubReads.");
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("calls a check failing on a base that is not the default branch failing on that base, not on main", async () => {
    githubReads(true);
    answerCheckRuns("failure");
    const client = await brokerClient();
    const text = resultText(await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "feat/parent-layer" } }));
    expect(text).toContain("failing on feat/parent-layer too. Class: failing on the base (feat/parent-layer).");
    expect(text).not.toContain("Class: failing on main");
    await client.close();
  });

  it("never calls a check failing on main when origin's default branch is unknown", async () => {
    githubReads(true);
    answerCheckRuns("failure");
    const answer = execMock.getMockImplementation()!;
    execMock.mockImplementation(async (cmd: string, ...rest: unknown[]) =>
      cmd === "git" ? { launched: true, error: null, exitCode: 1, stderr: "", stdout: "" } : answer(cmd, ...rest));
    const client = await brokerClient();
    const text = resultText(await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "main" } }));
    expect(text).toContain("Class: failing on the base (main).");
    await client.close();
  });

  it("describes both classes in the tool description", async () => {
    const client = await brokerClient();
    const tool = (await client.listTools()).tools.find((t) => t.name === "github_read");
    expect(tool?.description).toContain("failing on main");
    expect(tool?.description).toContain("failing on the base (<base>)");
    await client.close();
  });

  it.each([false, true])("reads nothing and raises no card for a pr read while git.branchHealth is off (reads allowed: %s)", async (allowed) => {
    githubReads(allowed);
    branchHealth(false);
    answerCheckRuns("failure");
    execMock.mockClear();
    const client = await brokerClient();
    const result = await client.callTool({ name: "github_read", arguments: { kind: "pr", ref: "elsewhere" } });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Nothing was read: the git.branchHealth feature is off.");
    expect(broker.cards(SESSION)).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("reads nothing for a pr card approved after git.branchHealth was turned off", async () => {
    githubReads(false);
    branchHealth(true);
    answerCheckRuns("failure");
    const client = await brokerClient();
    const call = client.callTool({ name: "github_read", arguments: { kind: "pr", ref: "elsewhere" } });
    const { cardId } = await cardAnnounced("pending");
    branchHealth(false);
    execMock.mockClear();
    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Nothing was read: the git.branchHealth feature is off.");
    expect(execMock).not.toHaveBeenCalled();
    await client.close();
  });

  it("still reads a check while git.branchHealth is off", async () => {
    githubReads(true);
    branchHealth(false);
    answerCheckRuns("success");
    const client = await brokerClient();
    const text = resultText(await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint", base: "main" } }));
    expect(text).toContain("it is not failing on main");
    await client.close();
  });

  it("a denied network-read card reads nothing", async () => {
    githubReads(false);
    branchHealth(true);
    const client = await brokerClient();
    const call = client.callTool({ name: "github_read", arguments: { kind: "pr", ref: "elsewhere" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "deny" });
    expect(resultText(await call)).toContain("Nothing ran.");
    expect(ghCalls()).toEqual([]);
    await client.close();
  });

  it("raises no card for a check read without the base to read it on", async () => {
    githubReads(false);
    const client = await brokerClient();
    const result = await client.callTool({ name: "github_read", arguments: { kind: "check", ref: "lint" } });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/^No card was raised: a check read needs the base branch/);
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("posts a draft under the operator's gh login only on Approve, with the body on stdin", async () => {
    githubReads(true);
    execMock.mockImplementation(async () => ({ launched: true, error: null, exitCode: 0, stderr: "", stdout: "https://github.com/o/r/pull/7#issuecomment-1\n" }));
    const client = await brokerClient();
    const call = client.callTool({ name: "draft_github_post", arguments: { kind: "comment", target: "7", body: "lint fails on main too" } });
    const { cardId } = await cardAnnounced("pending");
    // A draft is never allowed without its card, whatever the GitHub reads setting.
    expect(broker.cards(SESSION)[0]).toMatchObject({ kind: "draft-post", allowListKey: null });
    expect(ghCalls()).toEqual([]);
    await decide(cardId, { decision: "approve" });
    const text = resultText(await call);
    expect(text).toContain("Posted the comment on 7 under the operator's gh login: https://github.com/o/r/pull/7#issuecomment-1");
    expect(ghCalls()).toEqual([{ args: ["pr", "comment", "7", "--body-file", "-"], input: "lint fails on main too" }]);
    await client.close();
  });

  it.each(["--repo=someone/else", "-R", "7 --repo=x"])("raises no card for a draft whose target gh would read as a flag (%s)", async (target) => {
    const client = await brokerClient();
    const result = await client.callTool({ name: "draft_github_post", arguments: { kind: "comment", target, body: "x" } });
    expect(result.isError).toBe(true);
    expect(broker.cards(SESSION)).toEqual([]);
    expect(ghCalls()).toEqual([]);
    await client.close();
  });

  it.each([
    ["Discard", undefined],
    ["Copy", "Copied, not posted"],
  ])("%s posts nothing", async (_button, reason) => {
    const client = await brokerClient();
    const call = client.callTool({ name: "draft_github_post", arguments: { kind: "review", target: "7", body: "draft" } });
    const { cardId } = await cardAnnounced("pending");
    await decide(cardId, { decision: "deny", ...(reason && { reason }) });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Nothing was posted.");
    expect(ghCalls()).toEqual([]);
    await client.close();
  });

  it("refuses a draft-post rule written into the allow-list: the card is raised anyway", async () => {
    writeFileSync(join(root, ".hench", "sidecar", "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [{ tool: "draft_github_post", key: "*" }],
    }));
    const client = await brokerClient();
    const call = client.callTool({ name: "draft_github_post", arguments: { kind: "comment", target: "7", body: "x" } });
    await cardAnnounced("pending");
    expect(ghCalls()).toEqual([]);
    await client.close();
    // Closing the client ends the call it was waiting on.
    await expect(call).rejects.toThrow(/Connection closed/);
  });
});

describe("outputTail", () => {
  it("keeps output within the line and byte caps whole", () => {
    expect(outputTail("a\nb\n\n")).toEqual({ text: "a\nb", cutLines: 0, cutBytes: 0 });
    expect(outputTail("")).toEqual({ text: "", cutLines: 0, cutBytes: 0 });
  });

  it("cuts whole lines from the front to fit the byte cap", () => {
    const line = "x".repeat(999);
    const output = Array.from({ length: 20 }, () => line).join("\n");
    const tail = outputTail(output);
    expect(Buffer.byteLength(tail.text)).toBeLessThanOrEqual(SIDECAR_OUTPUT_MAX_BYTES);
    expect(tail.text.split("\n")).toHaveLength(8);
    expect(tail.cutLines).toBe(12);
    expect(tail.cutBytes).toBe(Buffer.byteLength(output) - Buffer.byteLength(tail.text));
  });

  it("keeps the end of a last line longer than the byte cap", () => {
    const output = `first\n${"é".repeat(SIDECAR_OUTPUT_MAX_BYTES)}`;
    const tail = outputTail(output);
    expect(Buffer.byteLength(tail.text)).toBeLessThanOrEqual(SIDECAR_OUTPUT_MAX_BYTES);
    expect(tail.text).toMatch(/^é+$/);
    expect(tail.cutBytes).toBe(Buffer.byteLength(output) - Buffer.byteLength(tail.text));
  });
});
