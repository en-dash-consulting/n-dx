/**
 * Approved Sidecar broker calls carry out their effect (story 12).
 *
 * The real route, broker and production actions: an MCP client stands in for
 * the session's vendor CLI, and the only fakes are the two spawn seams
 * (`spawnManaged` for the command job and the run, `exec` for
 * `ndx work --resolve`) and a registry that reports the session's turn running.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock, spawnManagedMock } = vi.hoisted(() => ({ execMock: vi.fn(), spawnManagedMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  execMock.mockImplementation(actual.exec);
  return { ...actual, exec: execMock, spawnManaged: spawnManagedMock };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { commandJobsOf, handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { createAnnouncingBroker, handleSidecarRoute, sidecarActions, type SidecarCardMessage } from "../../../src/server/routes-sidecar.js";
import type { SidecarBroker, SidecarCard } from "../../../src/server/sidecar/broker.js";
import { SIDECAR_OUTPUT_MAX_BYTES, outputTail } from "../../../src/server/sidecar/carry-out.js";
import type { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
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

async function brokerClient(): Promise<Client> {
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/mcp`)));
  return client;
}

async function decide(cardId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/cards/${cardId}`, {
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

async function serve(): Promise<void> {
  commandWaitMs = 10_000;
  server = await startRouteTestServer(async (req, res) =>
    (await handleSidecarRoute(req, res, ctx, broadcast, {
      registryFor: runningRegistry,
      brokerFor: () => broker,
      actionsFor: (c) => sidecarActions(c, broadcast, { commandWaitMs }),
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
    ].join("\n"));
    expect(spawnManagedMock).not.toHaveBeenCalled();

    await decide(cardId, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(spawnedArgs()).toHaveLength(1);
    expect(spawnedArgs()[0]).toEqual(expect.arrayContaining(["work", "--task=task-1", "--review"]));
    expect(resultText(result)).toMatch(/^The operator approved card \S+\. Started run exec-\w+ on task task-1 \(Carry it out\)/);
    await client.close();
  });

  it("starts nothing at guard.maxConcurrentProcesses, and says the limit is reached", async () => {
    writeFileSync(join(root, ".hench", "config.json"), JSON.stringify({ guard: { maxConcurrentProcesses: 1 } }));
    const client = await brokerClient();

    const first = client.callTool({ name: "start_work", arguments: { taskId: "task-1" } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    expect((await first).isError).toBeFalsy();
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);

    cardMessages = [];
    const second = client.callTool({ name: "start_work", arguments: { taskId: "task-2" } });
    await decide((await cardAnnounced("pending")).cardId, { decision: "approve" });
    const result = await second;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Nothing started: the concurrent run limit is reached \(1 of 1 runs/);
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
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
});

describe("tools carried out by a later batch", () => {
  beforeEach(serve);

  it.each([
    ["place_change_card", { change: "CH-1", target: "A1", relation: "amends" }, "the L2 Place lens"],
    ["propose_edit", { path: "a.ts", diff: "-a\n+b" }, "a later batch"],
    ["github_read", { kind: "pr", ref: "#1" }, "L2/H1"],
    ["draft_github_post", { kind: "comment", target: "#1", body: "hi" }, "L2/H1"],
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
