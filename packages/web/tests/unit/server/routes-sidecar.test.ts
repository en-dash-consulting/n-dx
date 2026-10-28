/**
 * Sidecar turn transport: POST a turn, announce frames over the socket with a
 * cursor, fetch the frames after a cursor.
 *
 * The vendor CLI is a scripted child through the session's `spawn` seam, shaped
 * like Claude's stream-json: a normal prompt replies with a long assistant
 * message and a result; a prompt containing HANG reports "working" and runs
 * until it is killed.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createAnnouncingBroker,
  handleSidecarRoute,
  sidecarTurnSpendRecorder,
  type SidecarCardMessage,
  type SidecarFramesMessage,
  type SidecarFramesResponse,
} from "../../../src/server/routes-sidecar.js";
import { readDashboardUsage } from "../../../src/server/dashboard-usage.js";
import type { SidecarBroker, SidecarCard } from "../../../src/server/sidecar/broker.js";
import type { SidecarActions } from "../../../src/server/sidecar/carry-out.js";
import { LENS_IDS } from "../../../src/server/sidecar/lens-packets.js";
import { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const REPLY = "r".repeat(2000);

let root: string;
let ctx: ServerContext;
let server: RouteTestServer;
let messages: SidecarFramesMessage[];
let registry: SidecarSessionRegistry;
let broker: SidecarBroker;
let spawns: number;

/** Claude stand-in: resumes `--resume <id>`, else mints `vendor-<n>`. */
const fakeSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  spawns += 1;
  const r = args.indexOf("--resume");
  const id = r >= 0 ? args[r + 1] : `vendor-${spawns}`;
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out = (o: unknown): void => { stdout.write(JSON.stringify(o) + "\n"); };
  const exit = (code: number | null, signal: string | null): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    Object.assign(child, { exitCode: code, signalCode: signal });
    stdout.end();
    setImmediate(() => { child.emit("exit", code, signal); child.emit("close", code, signal); });
  };
  Object.assign(child, {
    stdin,
    stdout,
    stderr: new PassThrough(),
    pid: undefined,
    exitCode: null,
    signalCode: null,
    kill: (signal: string) => { exit(null, signal); return true; },
  });
  let prompt = "";
  stdin.on("data", (chunk: Buffer) => { prompt += chunk.toString(); });
  stdin.on("end", () => {
    out({ type: "system", subtype: "init", session_id: id });
    if (prompt.includes("SIGNEDOUT")) {
      // Claude CLI 2.1.309 -p stream-json with an empty config dir: exit 1, and a
      // result frame whose subtype says "success" although is_error is true.
      out({
        type: "assistant", session_id: id, error: "authentication_failed",
        message: { id: `m-${spawns}`, model: "<synthetic>", content: [{ type: "text", text: "Not logged in · Please run /login" }] },
      });
      out({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", session_id: id, result: "Not logged in · Please run /login" });
      setImmediate(() => exit(1, null));
      return;
    }
    if (prompt.includes("TOOLS")) {
      // Recorded Claude stream-json: a Read call, answered on a `user` line by
      // a tool_result block naming the call's id.
      out({
        type: "assistant", session_id: id, parent_tool_use_id: null,
        message: {
          id: `m-${spawns}`, role: "assistant", model: "claude-sonnet-4-5",
          content: [{ type: "tool_use", id: "toolu_01R", name: "Read", input: { file_path: "/repo/a.ts" } }],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      });
      out({
        type: "user", session_id: id, parent_tool_use_id: null,
        message: { role: "user", content: [{ tool_use_id: "toolu_01R", type: "tool_result", content: "     1\texport const a = 1;" }] },
        tool_use_result: { type: "text", file: { filePath: "/repo/a.ts", numLines: 1 } },
      });
      out({ type: "result", session_id: id, result: "read it" });
      setImmediate(() => exit(0, null));
      return;
    }
    if (prompt.includes("HANG")) {
      out({ type: "assistant", session_id: id, message: { content: [{ type: "text", text: "working" }] } });
      return;
    }
    out({
      type: "assistant", session_id: id,
      message: { id: `m-${spawns}`, content: [{ type: "text", text: REPLY }], usage: { input_tokens: 10, output_tokens: 4 } },
    });
    out({ type: "result", session_id: id, result: REPLY });
    setImmediate(() => exit(0, null));
  });
  return child as unknown as ChildProcess;
};

/** Approved calls spawn nothing here; sidecar-carry-out.test.ts covers their effects. */
const noEffects: SidecarActions = {
  previewWork: async () => "preview",
  runCommand: () => ({ ok: true, text: "Ran it." }),
  startWork: async () => ({ ok: true, text: "Started it." }),
};

function newRegistry(): SidecarSessionRegistry {
  return new SidecarSessionRegistry({
    dir: join(root, ".hench", "sidecar"),
    connect: () => ({ spawn: fakeSpawn }),
    onTurnSpend: sidecarTurnSpendRecorder(ctx),
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "routes-sidecar-"));
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  messages = [];
  waiters = [];
  spawns = 0;
  registry = newRegistry();
  broker = createAnnouncingBroker(join(root, ".hench", "sidecar"), broadcast);
  server = await startRouteTestServer((req, res) =>
    handleSidecarRoute(req, res, ctx, broadcast, { registryFor: () => registry, brokerFor: () => broker, actionsFor: () => noEffects }));
});

afterEach(async () => {
  await server.close();
  await removeTestDir(root);
});

function api(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(`${server.baseUrl}/api/sidecar/sessions${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined && { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } }),
  });
}

async function createSession(): Promise<string> {
  const res = await api("", { method: "POST", body: { vendor: "claude", name: "Plan" } });
  expect(res.status).toBe(201);
  return (await res.json()).session.id;
}

async function frames(id: string, after: number): Promise<SidecarFramesResponse> {
  const res = await api(`/${id}/frames?after=${after}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** Resolves with the announcement that closes a turn in session `id`, already sent or still to come. */
function turnClosed(id: string): Promise<SidecarFramesMessage> {
  const isClosing = (m: SidecarFramesMessage): boolean => m.type === "sidecar:frames" && m.sessionId === id && !m.running;
  const sent = messages.find(isClosing);
  if (sent) return Promise.resolve(sent);
  return new Promise((resolve) => {
    waiters.push((m) => {
      if (!isClosing(m)) return false;
      resolve(m);
      return true;
    });
  });
}

/** Called with each broadcast; a waiter returning true is done. */
let waiters: Array<(m: SidecarFramesMessage) => boolean>;

function broadcast(data: unknown): void {
  const message = data as SidecarFramesMessage;
  messages.push(message);
  waiters = waiters.filter((waiter) => !waiter(message));
}

describe("sessions", () => {
  it("creates a session in the addressed worktree and lists it", async () => {
    const id = await createSession();
    const list = await (await api("")).json();
    expect(list.sessions).toEqual([
      expect.objectContaining({ running: false, session: expect.objectContaining({ id, worktree: root, name: "Plan", vendor: "claude", cursor: 0 }) }),
    ]);
    expect((await (await api(`/${id}`)).json()).session.id).toBe(id);
  });

  it("refuses a vendor without a resumable CLI session", async () => {
    expect((await api("", { method: "POST", body: { vendor: "openai" } })).status).toBe(400);
    expect((await api("", { method: "POST", body: {} })).status).toBe(400);
  });

  it("accepts a target on create and keeps it across a server restart", async () => {
    const res = await api("", { method: "POST", body: { vendor: "claude", lens: "describe", target: { ref: "T-1" } } });
    expect(res.status).toBe(201);
    const { session } = await res.json();
    expect(session.target).toEqual({ ref: "T-1" });

    const restarted = newRegistry();
    expect(restarted.get(session.id)).toMatchObject({ lens: "describe", target: { ref: "T-1" } });
  });

  it("refuses a target that is not an object with a string ref", async () => {
    for (const target of ["T-1", null, [], { ref: 3 }, { ref: " " }]) {
      expect((await api("", { method: "POST", body: { vendor: "claude", target } })).status).toBe(400);
    }
  });

  it("renames, re-lenses and re-targets with PATCH, each field optional, and persists it", async () => {
    const id = await createSession();
    const renamed = await api(`/${id}`, { method: "PATCH", body: { name: "Review" } });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).session).toMatchObject({ name: "Review" });

    const moved = await api(`/${id}`, { method: "PATCH", body: { lens: "describe", target: { ref: "T-2" } } });
    expect((await moved.json()).session).toMatchObject({ name: "Review", lens: "describe", target: { ref: "T-2" } });
    expect(newRegistry().get(id)).toMatchObject({ name: "Review", lens: "describe", target: { ref: "T-2" } });

    expect((await api(`/${id}`, { method: "PATCH", body: {} })).status).toBe(200);
  });

  it("refuses a bad PATCH body, an unknown session, and a lens or target change once ended", async () => {
    const id = await createSession();
    expect((await api(`/${id}`, { method: "PATCH", body: { name: "" } })).status).toBe(400);
    expect((await api(`/${id}`, { method: "PATCH", body: { target: "T-1" } })).status).toBe(400);
    expect((await api("/nope", { method: "PATCH", body: { name: "x" } })).status).toBe(404);

    await api(`/${id}/end`, { method: "POST" });
    expect((await api(`/${id}`, { method: "PATCH", body: { lens: "plan" } })).status).toBe(409);
    expect((await api(`/${id}`, { method: "PATCH", body: { name: "Done" } })).status).toBe(200);
  });

  it("answers 404 for a session it does not hold and 405 for a wrong method", async () => {
    expect((await api("/nope/frames")).status).toBe(404);
    const id = await createSession();
    expect((await api(`/${id}/turns`)).status).toBe(405);
    expect((await api(`/${id}/frames`, { method: "POST" })).status).toBe(405);
  });
});

describe("lens registry", () => {
  it("lists every lens M1 registers, with what an unavailable one waits on", async () => {
    const res = await fetch(`${server.baseUrl}/api/sidecar/lenses`);
    expect(res.status).toBe(200);
    const { lenses } = await res.json() as { lenses: Array<{ id: string; available: boolean; needs?: string }> };
    expect(lenses.map((l) => l.id)).toEqual([...LENS_IDS]);
    expect(lenses.find((l) => l.id === "plan")).toEqual({ id: "plan", available: true });
    expect(lenses.find((l) => l.id === "guide")).toEqual({ id: "guide", available: false, needs: "the queue planner" });
    expect((await fetch(`${server.baseUrl}/api/sidecar/lenses`, { method: "POST" })).status).toBe(405);
  });
});

describe("spend", () => {
  async function runTurn(id: string, prompt: string): Promise<void> {
    const closed = turnClosed(id);
    expect((await api(`/${id}/turns`, { method: "POST", body: { prompt } })).status).toBe(202);
    await closed;
  }

  it("appends one ledger line per finished turn, with the lens when set", async () => {
    const lensed = (await (await api("", { method: "POST", body: { vendor: "claude", model: "claude-opus-5", lens: "plan" } })).json()).session.id;
    await runTurn(lensed, "one");
    const plain = await createSession();
    await runTurn(plain, "two");

    const lines = readDashboardUsage(root);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      command: "sidecar", vendor: "claude", model: "claude-opus-5", inputTokens: 10, outputTokens: 4, calls: 1, outcome: "success", lens: "plan",
    });
    expect(lines[1]).toMatchObject({ command: "sidecar", model: "unknown", outcome: "success" });
    expect(lines[1]).not.toHaveProperty("lens");
  });

  it("records a failed turn as an error outcome", async () => {
    const id = await createSession();
    await runTurn(id, "SIGNEDOUT");
    expect(readDashboardUsage(root)).toEqual([expect.objectContaining({ command: "sidecar", outcome: "error" })]);
  });

  it("carries each session's estimated cost in the sessions response", async () => {
    const id = (await (await api("", { method: "POST", body: { vendor: "claude", model: "claude-opus-5" } })).json()).session.id;
    const fresh = (await (await api(`/${id}`)).json()).estimatedCost;
    expect(fresh.totalRaw).toBe(0);

    await runTurn(id, "one");
    const { sessions } = await (await api("")).json();
    expect(sessions[0].estimatedCost.totalRaw).toBeGreaterThan(0);
    expect(sessions[0].estimatedCost.byModel[0]).toMatchObject({ model: "claude-opus-5" });
  });
});

describe("turns", () => {
  it("answers 202 at once, announces each frame's cursor, then closes the turn", async () => {
    const id = await createSession();
    const res = await api(`/${id}/turns`, { method: "POST", body: { prompt: "hello" } });
    expect(res.status).toBe(202);
    const started = await res.json();
    expect(started).toMatchObject({ from: 0, running: true, session: { cursor: 1 } });

    const closing = await turnClosed(id);
    expect(closing).toMatchObject({ type: "sidecar:frames", status: "completed", running: false });
    const cursors = messages.filter((m) => m.running).map((m) => m.cursor);
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
    expect(closing.cursor).toBe(cursors.at(-1));

    const fetched = await frames(id, started.from);
    expect(fetched.frames[0]).toMatchObject({ seq: 1, type: "user", text: "hello" });
    expect(fetched.cursor).toBe(closing.cursor);
    expect(fetched.running).toBe(false);
  });

  it("carries the whole reply in the assistant and completion frames", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "hello" } });
    await turnClosed(id);
    const events = (await frames(id, 0)).frames.flatMap((f) => (f.type === "event" ? [f.event] : []));
    expect(events.find((e) => e.type === "assistant")?.text).toBe(REPLY);
    expect(events.find((e) => e.type === "completion")?.completionSummary).toBe(REPLY);
  });

  it("keeps a Claude tool result in the transcript, naming the call it answers", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "TOOLS" } });
    await turnClosed(id);
    const events = (await frames(id, 0)).frames.flatMap((f) => (f.type === "event" ? [f.event] : []));
    expect(events.find((e) => e.type === "tool_use")?.toolCall).toMatchObject({ tool: "Read", id: "toolu_01R" });
    expect(events.filter((e) => e.type === "tool_result").map((e) => e.toolResult)).toEqual([
      { tool: "unknown", output: "     1\texport const a = 1;", durationMs: 0, callId: "toolu_01R" },
    ]);
  });

  it("marks a turn that failed on the vendor's sign-in error, and no other failure", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "SIGNEDOUT" } });
    const closing = await turnClosed(id);
    expect(closing).toMatchObject({ running: false, status: "failed", signedOut: true });
    expect(closing.error).toContain("Not logged in");

    const ok = await createSession();
    await api(`/${ok}/turns`, { method: "POST", body: { prompt: "hello" } });
    expect((await turnClosed(ok)).signedOut).toBeUndefined();
  });

  it("keeps the signed-out outcome on the session until a later turn clears it", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "SIGNEDOUT" } });
    await turnClosed(id);
    const kept = (await (await api(`/${id}`)).json()).session.lastTurn;
    expect(kept).toMatchObject({ status: "failed", signedOut: true });
    expect(kept.error).toContain("Not logged in");
    expect((await (await api("")).json()).sessions[0].session.lastTurn).toEqual(kept);

    messages.length = 0;
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "hello" } });
    await turnClosed(id);
    expect((await (await api(`/${id}`)).json()).session.lastTurn).toEqual({ status: "completed" });
  });

  it("still closes the turn when saving its outcome fails", async () => {
    const id = await createSession();
    registry.recordTurnEnd = () => { throw new Error("ENOSPC: no space left on device"); };
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "SIGNEDOUT" } });
    expect(await turnClosed(id)).toMatchObject({ running: false, status: "failed", signedOut: true });
  });

  it("refuses a second turn while one runs, and an empty prompt", async () => {
    const id = await createSession();
    expect((await api(`/${id}/turns`, { method: "POST", body: { prompt: " " } })).status).toBe(400);
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "HANG" } });
    expect((await api(`/${id}/turns`, { method: "POST", body: { prompt: "again" } })).status).toBe(409);
    await api(`/${id}/interrupt`, { method: "POST" });
    await turnClosed(id);
  });

  it("refuses a turn on an ended session", async () => {
    const id = await createSession();
    expect((await (await api(`/${id}/end`, { method: "POST" })).json()).session.endedAt).toBeTruthy();
    expect((await api(`/${id}/turns`, { method: "POST", body: { prompt: "hi" } })).status).toBe(409);
  });
});

describe("reload", () => {
  it("resumes from the cursor: nothing before it is fetched again, across a server restart too", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "one" } });
    const { cursor } = await turnClosed(id);
    expect((await frames(id, cursor)).frames).toEqual([]);

    // A restarted server: a fresh registry over the same directory.
    registry = newRegistry();
    messages = [];
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "two" } });
    await turnClosed(id);

    const after = await frames(id, cursor);
    expect(after.frames[0]).toMatchObject({ seq: cursor + 1, type: "user", text: "two" });
    expect(after.frames.every((f) => f.seq > cursor)).toBe(true);
  });

  it("refuses an after that is not a non-negative integer", async () => {
    const id = await createSession();
    expect((await api(`/${id}/frames?after=-1`)).status).toBe(400);
    expect((await api(`/${id}/frames?after=x`)).status).toBe(400);
  });
});

describe("interrupt", () => {
  // The 2 s bound on a CLI that ignores SIGTERM is llm-client's
  // vendor-session test; this is the route reaching it.
  it("stops the running turn and keeps the session usable", async () => {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "HANG" } });
    expect((await (await api(`/${id}`)).json()).running).toBe(true);

    expect(await (await api(`/${id}/interrupt`, { method: "POST" })).json()).toEqual({ interrupted: true });
    expect((await turnClosed(id)).status).toBe("interrupted");
    expect((await (await api(`/${id}`)).json()).running).toBe(false);

    messages = [];
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "after" } });
    expect((await turnClosed(id)).status).toBe("completed");
  });

  it("reports false when no turn runs", async () => {
    const id = await createSession();
    expect(await (await api(`/${id}/interrupt`, { method: "POST" })).json()).toEqual({ interrupted: false });
  });
});

describe("broker", () => {
  /** An MCP client on the session's broker, connected as the vendor CLI would be. */
  async function brokerClient(id: string): Promise<Client> {
    const client = new Client({ name: "test-cli", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/sidecar/sessions/${id}/mcp`)));
    return client;
  }

  /** The `sidecar:card` announcement with `status`, already sent or still to come. */
  function cardAnnounced(id: string, status: string): Promise<SidecarCardMessage> {
    const matches = (m: unknown): m is SidecarCardMessage => {
      const c = m as SidecarCardMessage;
      return c.type === "sidecar:card" && c.sessionId === id && c.status === status;
    };
    const sent = (messages as unknown[]).find(matches);
    if (sent) return Promise.resolve(sent);
    return new Promise((resolve) => {
      waiters.push((m) => {
        if (!matches(m)) return false;
        resolve(m);
        return true;
      });
    });
  }

  async function runningSession(): Promise<string> {
    const id = await createSession();
    await api(`/${id}/turns`, { method: "POST", body: { prompt: "HANG" } });
    return id;
  }

  function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
    return (result.content as Array<{ text: string }>)[0].text;
  }

  it("serves the nine broker tools while a turn runs, and refuses with no turn running", async () => {
    const idle = await createSession();
    const refused = await fetch(`${server.baseUrl}/api/sidecar/sessions/${idle}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(refused.status).toBe(409);

    const id = await runningSession();
    const client = await brokerClient(id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "draft_github_post", "github_read", "ledger_append", "migration_decision", "place_change_card",
      "propose_edit", "propose_prd_change", "run_command", "start_work",
    ]);
    await client.close();
    await api(`/${id}/interrupt`, { method: "POST" });
  });

  it("holds a write tool's call until the operator decides its card", async () => {
    const id = await runningSession();
    const client = await brokerClient(id);
    const call = client.callTool({ name: "start_work", arguments: { taskId: "t1" } });

    const { cardId } = await cardAnnounced(id, "pending");
    const { cards } = await (await api(`/${id}/cards`)).json() as { cards: SidecarCard[] };
    expect(cards).toEqual([
      expect.objectContaining({ id: cardId, tool: "start_work", kind: "work", allowListKey: null, status: "pending" }),
    ]);

    // Work can never be allow-listed, whatever the operator asks.
    const remember = await api(`/${id}/cards/${cardId}`, { method: "POST", body: { decision: "approve", remember: true } });
    expect(remember.status).toBe(409);

    const decided = await api(`/${id}/cards/${cardId}`, { method: "POST", body: { decision: "deny", reason: "later" } });
    expect(decided.status).toBe(200);
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/denied card .*later/);

    await client.close();
    await api(`/${id}/interrupt`, { method: "POST" });
  });

  it("lets a remembered command through the allow-list without a card, until it is revoked", async () => {
    const id = await runningSession();
    const client = await brokerClient(id);
    const argv = ["ndx", "status", "."];
    const first = client.callTool({ name: "run_command", arguments: { argv } });
    const { cardId } = await cardAnnounced(id, "pending");
    await api(`/${id}/cards/${cardId}`, { method: "POST", body: { decision: "approve", remember: true } });
    expect(resultText(await first)).toMatch(/approved card/);

    const second = await client.callTool({ name: "run_command", arguments: { argv } });
    expect(resultText(second)).toMatch(/Sidecar allow-list/);
    expect(broker.cards(id)).toHaveLength(1);

    const listed = await (await fetch(`${server.baseUrl}/api/sidecar/allow-list`)).json();
    expect(listed).toEqual({ rules: [{ tool: "run_command", key: JSON.stringify(argv) }] });
    const revoked = await fetch(`${server.baseUrl}/api/sidecar/allow-list`, {
      method: "DELETE",
      body: JSON.stringify({ tool: "run_command", key: JSON.stringify(argv) }),
    });
    expect(await revoked.json()).toEqual({ removed: true });

    await client.close();
    await api(`/${id}/interrupt`, { method: "POST" });
  });

  it("withdraws a pending card when the operator stops the turn", async () => {
    const id = await runningSession();
    const client = await brokerClient(id);
    const call = client.callTool({ name: "propose_edit", arguments: { path: "a.ts", diff: "-a\n+b" } });
    await cardAnnounced(id, "pending");
    await api(`/${id}/interrupt`, { method: "POST" });
    await cardAnnounced(id, "withdrawn");
    expect(broker.cards(id)[0].status).toBe("withdrawn");
    expect((await call).isError).toBe(true);
    await client.close();
  });

  it("withdraws waiting cards with the note \"session ended\" when the session ends", async () => {
    const id = await runningSession();
    const client = await brokerClient(id);
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await cardAnnounced(id, "pending");
    const ended = await api(`/${id}/end`, { method: "POST" });
    expect(ended.status).toBe(200);
    await cardAnnounced(id, "withdrawn");
    const { cards } = await (await api(`/${id}/cards`)).json();
    expect(cards).toEqual([expect.objectContaining({ status: "withdrawn", reason: "session ended" })]);
    expect((await call).isError).toBe(true);
    await client.close();
  });
});
