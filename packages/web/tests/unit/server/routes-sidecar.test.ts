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
import {
  handleSidecarRoute,
  type SidecarFramesMessage,
  type SidecarFramesResponse,
} from "../../../src/server/routes-sidecar.js";
import { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const REPLY = "r".repeat(2000);

let root: string;
let ctx: ServerContext;
let server: RouteTestServer;
let messages: SidecarFramesMessage[];
let registry: SidecarSessionRegistry;
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
    if (prompt.includes("HANG")) {
      out({ type: "assistant", session_id: id, message: { content: [{ type: "text", text: "working" }] } });
      return;
    }
    out({ type: "assistant", session_id: id, message: { id: `m-${spawns}`, content: [{ type: "text", text: REPLY }] } });
    out({ type: "result", session_id: id, result: REPLY });
    setImmediate(() => exit(0, null));
  });
  return child as unknown as ChildProcess;
};

function newRegistry(): SidecarSessionRegistry {
  return new SidecarSessionRegistry({ dir: join(root, ".hench", "sidecar"), connect: () => ({ spawn: fakeSpawn }) });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "routes-sidecar-"));
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  messages = [];
  waiters = [];
  spawns = 0;
  registry = newRegistry();
  server = await startRouteTestServer((req, res) =>
    handleSidecarRoute(req, res, ctx, broadcast, { registryFor: () => registry }));
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
  const isClosing = (m: SidecarFramesMessage): boolean => m.sessionId === id && !m.running;
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

  it("answers 404 for a session it does not hold and 405 for a wrong method", async () => {
    expect((await api("/nope/frames")).status).toBe(404);
    const id = await createSession();
    expect((await api(`/${id}/turns`)).status).toBe(405);
    expect((await api(`/${id}/frames`, { method: "POST" })).status).toBe(405);
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
