/**
 * The hub-scope Sidecar session on its host project server: one per machine
 * under `<ndx home>/hub/sidecar/`, held by a host lock naming pid and port,
 * Claude only, every turn opening with a freshly built hub snapshot, and a
 * 40k context ceiling the host's config can move.
 *
 * Two "servers" are two route handlers with different pids over the same
 * per-user directory. The vendor CLI is a scripted Claude stand-in that
 * records each prompt; the hub's API is a fake fetch.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { HUB_PID_FILE, hubLedgerPath, hubSessionHostLockPath, hubSidecarDir, readHubSessionHostLock } from "../../../src/hub/index.js";
import { enforceRouteFeatureGate } from "../../../src/server/route-feature-gates.js";
import { BROWSER_SESSION_SCRIPT } from "../../../src/shared/index.js";
import {
  createAnnouncingBroker,
  handleSidecarRoute,
  hubLedgerTarget,
  hubSidecarContextOptions,
  isHubSidecarPath,
  releaseHubSessionHostForSidecarOff,
  releaseHubSessionHostOnShutdown,
  type SidecarFramesMessage,
} from "../../../src/server/routes-sidecar.js";
import { SidecarBroker } from "../../../src/server/sidecar/broker.js";
import { HUB_CHECKPOINT_PROMPT } from "../../../src/server/sidecar/context-refresh.js";
import { appendLedgerEntryAt, readLedger, readLedgerAt } from "../../../src/server/sidecar/ledger.js";
import { SidecarSessionRegistry, worktreeSidecarDir, type SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const HUB_BASE = "http://127.0.0.1:3999";

let root: string;
let home: string;
let ctx: ServerContext;
let prompts: string[];
let spawns: number;
let alive: Set<number>;
let servers: RouteTestServer[];
let messages: SidecarFramesMessage[];
/** The project's worktree list the fake hub answers with; a test edits it between turns. */
let worktrees: unknown[];
/** While set, the Claude stand-in answers every turn with an error, as a signed-out CLI does. */
let failTurns = false;
/** Finishers of HOLD turns still running. */
let held: Array<() => void> = [];

/** Claude stand-in that records each prompt. An operator turn containing BIG reports 50k tokens of context. */
const fakeSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  spawns += 1;
  const r = args.indexOf("--resume");
  const id = r >= 0 ? args[r + 1] : `vendor-${spawns}`;
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out = (o: unknown): void => { stdout.write(JSON.stringify(o) + "\n"); };
  /** What a kill does: nothing, except to a STOPPABLE turn, which it ends. */
  let onKill = (): void => {};
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => { onKill(); return true; } });
  let prompt = "";
  stdin.on("data", (chunk: Buffer) => { prompt += chunk.toString(); });
  stdin.on("end", () => {
    prompts.push(prompt);
    // A cold prompt quotes the BIG exchange verbatim; only the operator's own BIG turn is big.
    const input = prompt.includes("BIG") && !prompt.includes(HUB_CHECKPOINT_PROMPT) && !prompt.includes("context was refreshed") ? 50_000 : 100;
    out({ type: "system", subtype: "init", session_id: id });
    // A HANG turn never ends, so its broker stays open for the test to reach.
    if (prompt.includes("HANG")) return;
    const finish = (): void => {
      out({ type: "assistant", session_id: id, message: { id: `m-${spawns}`, content: [{ type: "text", text: "ok" }], usage: { input_tokens: input, output_tokens: 4 } } });
      out({ type: "result", session_id: id, result: failTurns ? "not logged in" : "ok", ...(failTurns && { is_error: true }) });
      stdout.end();
      Object.assign(child, { exitCode: failTurns ? 1 : 0 });
      setImmediate(() => { child.emit("exit", 0, null); child.emit("close", 0, null); });
    };
    // A HOLD turn ends when the test calls the finisher it leaves in `held`.
    if (prompt.includes("HOLD")) {
      held.push(finish);
      if (prompt.includes("STOPPABLE")) onKill = () => { onKill = () => {}; finish(); };
    } else finish();
  });
  return child as unknown as ChildProcess;
};

/** The project's workspace keys the fake hub answers with. */
let workspaces: { anchor: string; workspaces: Array<{ key: string; path: string }> };
/** Every handoff POST the fake hub forwarded: the path and the body. */
let handoffs: Array<{ path: string; body: unknown }>;

/** The hub's API and one healthy project behind it. */
const fakeHubFetch = (async (url: string, init?: RequestInit) => {
  const path = url.slice(HUB_BASE.length);
  if (init?.method === "POST" && /^\/p\/app(\/w\/[^/]+)?\/api\/sidecar\/handoff$/.test(path)) {
    handoffs.push({ path, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ session: { id: "wt-session", name: "From the hub" }, created: true }), { status: 201 });
  }
  const answers: Record<string, unknown> = {
    "/api/hub/overview": { projects: [{ id: "app", name: "app", repoRoot: "/r/app", url: "/p/app/", state: "healthy", port: null, reachable: true, error: null, branch: "main", dirtyFiles: 0, activeRuns: 0, percentComplete: null, nextTaskTitle: null, analyzedAt: null, repoName: null, remoteHost: null, readiness: null, infrastructure: null }] },
    "/api/hub/queue": { entries: [], dropped: [], running: 0, freeMemoryBytes: null, availableBytes: null, pressure: "unknown", limits: { maxSessions: 4, memoryFloorBytes: 0 }, memoryPaused: false },
    "/p/app/api/status": { rex: { exists: true, layout: "v2" } },
    "/p/app/api/hench/concurrency": { totalRunning: 0, maxConcurrent: 3 },
    "/p/app/api/workspaces": workspaces,
    "/p/app/api/worktrees": worktrees,
    "/p/app/api/rex/claims": { claims: [] },
    "/p/app/api/changesets": { changesets: [] },
  };
  if (!(path in answers)) return new Response("nope", { status: 404 });
  return new Response(JSON.stringify(answers[path]), { status: 200 });
}) as typeof fetch;

function writeProjectConfig(config: Record<string, unknown>): void {
  writeFileSync(join(ctx.projectDir, ".n-dx.json"), JSON.stringify(config));
}

/** A project server whose hub-session routes run as `pid` on `port`, over `projectDir` (the shared project by default). */
async function startHost(pid: number, port: number, drawerHtml?: () => string | null, projectDir?: string): Promise<RouteTestServer> {
  const hostCtx: ServerContext = { ...ctx, ...(projectDir && { projectDir }), port };
  const server = await startRouteTestServer((req: IncomingMessage, res: ServerResponse) => {
    // As start.ts does: the feature gate runs before any route, and a refused
    // hub session route gives up the host lock.
    if (enforceRouteFeatureGate(req, res, hostCtx)) {
      if (isHubSidecarPath((req.url || "/").split("?")[0])) void releaseHubSessionHostForSidecarOff(hostCtx, { homeDir: home, pid });
      return Promise.resolve(true);
    }
    return handleSidecarRoute(req, res, hostCtx, (m) => { messages.push(m as SidecarFramesMessage); }, {
      hub: {
        homeDir: home,
        pid,
        isAlive: (p) => alive.has(p),
        fetch: fakeHubFetch,
        ...(drawerHtml && { drawerHtml }),
        registryFor: (dir) => new SidecarSessionRegistry({
          dir,
          connect: () => ({ spawn: fakeSpawn }),
          context: hubSidecarContextOptions(hostCtx, dir, { homeDir: home, fetch: fakeHubFetch }),
        }),
      },
    });
  });
  servers.push(server);
  return server;
}

function hubApi(server: RouteTestServer, path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(`${server.baseUrl}/api/sidecar/hub/sessions${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined && { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } }),
  });
}

/** Post a turn and wait for the announcement that closes it. */
async function turn(server: RouteTestServer, id: string, prompt: string): Promise<void> {
  const from = messages.length;
  const res = await hubApi(server, `/${id}/turns`, { method: "POST", body: { prompt } });
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(messages.slice(from).some((m) => m.sessionId === id && !m.running)).toBe(true));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "routes-sidecar-hub-"));
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const projectDir = join(root, "project");
  mkdirSync(projectDir, { recursive: true });
  ctx = { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
  writeProjectConfig({ features: { web: { sidecar: true } } });
  writeFileSync(join(home, HUB_PID_FILE), JSON.stringify({ pid: 1, port: 3999, startedAt: "" }));
  prompts = [];
  spawns = 0;
  messages = [];
  worktrees = [];
  workspaces = { anchor: "main", workspaces: [] };
  handoffs = [];
  failTurns = false;
  held = [];
  servers = [];
  alive = new Set([1001, 2002]);
});

afterEach(async () => {
  for (const server of servers) await server.close();
  await removeTestDir(root);
});

describe("one hub session per machine", () => {
  it("persists under <ndx home>/hub/sidecar/ with a host lock naming pid and port, and a second create returns the same id", async () => {
    const host = await startHost(1001, 4321);
    const first = await hubApi(host, "", { method: "POST", body: { vendor: "claude" } });
    expect(first.status).toBe(201);
    const { session } = await first.json();
    expect(session).toMatchObject({ scope: "hub", lens: "hub", worktree: hubSidecarDir(home) });

    const again = await hubApi(host, "", { method: "POST", body: { vendor: "claude", name: "another" } });
    expect(again.status).toBe(200);
    expect((await again.json()).session.id).toBe(session.id);

    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001, port: 4321 });
    const index = JSON.parse(readFileSync(join(hubSidecarDir(home), "index.json"), "utf-8"));
    expect(index.sessions.map((s: { id: string }) => s.id)).toEqual([session.id]);
  });

  it("on another project server, a create names the existing session and its host, and everything else refuses", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();

    const other = await startHost(2002, 5555);
    const created = await hubApi(other, "", { method: "POST", body: { vendor: "claude" } });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ session: { id: session.id }, hostedBy: { pid: 1001, port: 4321 } });

    const listed = await hubApi(other, "");
    expect(listed.status).toBe(409);
    expect((await listed.json()).error).toContain("pid 1001 on port 4321");
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001 });
  });

  it("when the host dies, the next server takes the lock and resumes the session from disk", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "first");

    alive.delete(1001);
    const next = await startHost(2002, 5555);
    const got = await hubApi(next, `/${session.id}`);
    expect(got.status).toBe(200);
    expect((await got.json()).session).toMatchObject({ id: session.id, turns: 1, resumeId: "vendor-1" });
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 2002, port: 5555 });

    await turn(next, session.id, "second");
    expect(prompts).toHaveLength(2);
  });

  it("refuses Codex, naming that its read-only sandbox can still read repositories", async () => {
    const host = await startHost(1001, 4321);
    const res = await hubApi(host, "", { method: "POST", body: { vendor: "codex" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Codex: its read-only sandbox can still read repositories/);
    expect(existsSync(join(hubSidecarDir(home), "index.json"))).toBe(false);
  });

  it("keeps the hub lens: another lens or a target is refused", async () => {
    const host = await startHost(1001, 4321);
    expect((await hubApi(host, "", { method: "POST", body: { vendor: "claude", lens: "plan" } })).status).toBe(400);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}`, { method: "PATCH", body: { lens: "explain" } })).status).toBe(400);
    expect((await hubApi(host, `/${session.id}`, { method: "PATCH", body: { name: "Machine" } })).status).toBe(200);
  });

  it("is refused whole while the host's web.sidecar is off, and takes no lock", async () => {
    writeProjectConfig({});
    const host = await startHost(1001, 4321);
    const res = await hubApi(host, "", { method: "POST", body: { vendor: "claude" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("web.sidecar");
    expect(existsSync(hubSessionHostLockPath(home))).toBe(false);
  });

  it("gives up the lock when its web.sidecar is turned off, once the hub turn running on it finishes", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HOLD" } })).status).toBe(202);
    await vi.waitFor(() => expect(held).toHaveLength(1));

    const otherDir = join(root, "other");
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: true } } }));
    const other = await startHost(2002, 5555, undefined, otherDir);

    writeProjectConfig({});
    expect((await hubApi(host, "")).status).toBe(403);
    // The turn still runs on the old host, so the lock stays and nobody else resumes the session.
    expect((await hubApi(other, "")).status).toBe(409);
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001, port: 4321 });

    held[0]();
    await vi.waitFor(() => expect(readHubSessionHostLock(home)).toBeNull());
    const got = await hubApi(other, `/${session.id}`);
    expect(got.status).toBe(200);
    expect((await got.json()).session).toMatchObject({ id: session.id, turns: 1 });
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 2002, port: 5555 });
  });

  it("on shutdown mid-turn, keeps the lock until the hub turn settles, refusing new hub requests meanwhile", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HOLD" } })).status).toBe(202);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const other = await startHost(2002, 5555);

    let released: boolean | undefined;
    const release = releaseHubSessionHostOnShutdown(4321, { homeDir: home, pid: 1001 }).then((r) => { released = r; });
    // The stand-in ignores the interrupt, so the turn is still writing the session.
    expect((await hubApi(other, "")).status).toBe(409);
    expect((await hubApi(host, "")).status).toBe(503);
    expect(released).toBeUndefined();
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001, port: 4321 });

    held[0]();
    await release;
    expect(released).toBe(true);
    const got = await hubApi(other, `/${session.id}`);
    expect(got.status).toBe(200);
    expect((await got.json()).session).toMatchObject({ id: session.id, turns: 1 });
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 2002, port: 5555 });
  });

  it("on shutdown, interrupts the running hub turn and releases the lock once it stops", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HOLD STOPPABLE" } })).status).toBe(202);
    await vi.waitFor(() => expect(held).toHaveLength(1));

    // Nothing but the interrupt ends this turn inside the wait.
    expect(await releaseHubSessionHostOnShutdown(4321, { homeDir: home, pid: 1001, waitMs: 2_000 })).toBe(true);
    expect(readHubSessionHostLock(home)).toBeNull();
  });

  it("on shutdown, leaves the lock to dead-pid takeover when the hub turn outlasts the wait", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HOLD" } })).status).toBe(202);
    await vi.waitFor(() => expect(held).toHaveLength(1));

    expect(await releaseHubSessionHostOnShutdown(4321, { homeDir: home, pid: 1001, waitMs: 20 })).toBe(false);
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001, port: 4321 });
    held[0]();
  });

  it("on shutdown with no hub turn running, releases the lock at once", async () => {
    const host = await startHost(1001, 4321);
    await hubApi(host, "", { method: "POST", body: { vendor: "claude" } });
    expect(await releaseHubSessionHostOnShutdown(4321, { homeDir: home, pid: 1001 })).toBe(true);
    expect(readHubSessionHostLock(home)).toBeNull();
  });

  it("keeps the lock when web.sidecar is back on by the time its turn finishes", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HOLD" } })).status).toBe(202);
    await vi.waitFor(() => expect(held).toHaveLength(1));

    writeProjectConfig({});
    expect((await hubApi(host, "")).status).toBe(403);
    writeProjectConfig({ features: { web: { sidecar: true } } });
    const from = messages.length;
    held[0]();
    await vi.waitFor(() => expect(messages.slice(from).some((m) => m.sessionId === session.id && !m.running)).toBe(true));
    expect((await hubApi(host, "")).status).toBe(200);
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: 1001, port: 4321 });
  });
});

describe("the hub lens packet", () => {
  it("opens every turn with a snapshot rebuilt for it, marking what changed since the last turn", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "what is the state?");
    worktrees = [{ path: "/r/app/wt", branch: "feat/x", isAnchor: false, dirtyFiles: 2, runs: { running: 1, latest: null } }];
    await turn(host, session.id, "and now?");

    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain("# Sidecar context packet: hub");
      expect(prompt).toContain("## Hub snapshot");
      expect(prompt).toContain("You cannot read files");
    }
    expect(prompts[0]).not.toContain("feat/x");
    expect(prompts[1]).toMatch(/Δ.*feat\/x|feat\/x.*Δ/);
    expect(existsSync(join(hubSidecarDir(home), `${session.id}.snapshot.json`))).toBe(true);
  });

  it("keeps the last delivered fingerprints when a turn fails after its packet was built, so the next turn still marks Δ", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "first");
    const snapshotPath = join(hubSidecarDir(home), `${session.id}.snapshot.json`);
    const delivered = readFileSync(snapshotPath, "utf-8");

    worktrees = [{ path: "/r/app/wt", branch: "feat/x", isAnchor: false, dirtyFiles: 2, runs: { running: 1, latest: null } }];
    failTurns = true;
    await turn(host, session.id, "lost");
    expect(readFileSync(snapshotPath, "utf-8")).toBe(delivered);

    failTurns = false;
    await turn(host, session.id, "again");
    expect(prompts.at(-1)).toMatch(/Δ.*feat\/x|feat\/x.*Δ/);
    expect(readFileSync(snapshotPath, "utf-8")).not.toBe(delivered);
  });

  it("reports, and does not throw, when a delivered snapshot's fingerprints cannot be saved", async () => {
    const dir = hubSidecarDir(home);
    mkdirSync(dir, { recursive: true });
    const options = hubSidecarContextOptions({ ...ctx, port: 4321 }, dir, { homeDir: home, fetch: fakeHubFetch });
    const record = { id: "s-1", lens: "hub" } as SidecarSessionRecord;
    expect(await options.packet!(record, new AbortController().signal)).toContain("## Hub snapshot");
    // Built, then blocked: a non-empty directory where the fingerprints go makes the atomic rename fail.
    mkdirSync(join(dir, "s-1.snapshot.json", "x"), { recursive: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => options.packetDelivered!(record)).not.toThrow();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("could not save the hub snapshot fingerprints for session s-1"));
    } finally {
      error.mockRestore();
    }
  });
});

describe("what the hub home and its drawer read", () => {
  const get = (server: RouteTestServer, path: string): Promise<Response> => fetch(`${server.baseUrl}/api/sidecar/hub${path}`);

  it("serves the drawer-only page from any project server, and says so when it was not built", async () => {
    const built = await startHost(1001, 4321, () => '<!doctype html><title>Hub session</title><body class="hub-session-page"><div id="app"></div></body>');
    const page = await get(built, "/drawer");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    // The hub home frames it; nothing of another origin may.
    expect(page.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(page.headers.get("content-security-policy")).not.toContain("frame-ancestors 'none'");
    const html = await page.text();
    expect(html).toContain("<title>Hub session</title>");
    // Signed in from its tab: fetches carry the session credential, the socket a ticket.
    expect(html.startsWith(`<script>${BROWSER_SESSION_SCRIPT}</script>`)).toBe(true);
    // The page's paths ride in with it, every one through the hub, ahead of the app root.
    const config = /<body class="hub-session-page"><script type="application\/json" id="hub-session-config">(.*?)<\/script><div id="app">/.exec(html);
    expect(JSON.parse(config![1])).toEqual({
      sessions: "/hub/session/sessions",
      lens: "/hub/session/lens",
      snapshot: "/hub/session/snapshot",
      handoff: "/hub/session/handoff",
      socket: "/hub/session",
      closeMessage: "ndx:hub-session:close",
    });

    const unbuilt = await startHost(2002, 5555, () => null);
    const missing = await get(unbuilt, "/drawer");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toContain("not built");
    // Neither read takes the host lock: no session was asked for.
    expect(readHubSessionHostLock(home)).toBeNull();
  });

  it("reports the hub lens available with the hub ceiling, following the host's config", async () => {
    const host = await startHost(1001, 4321);
    expect(await (await get(host, "/lens")).json()).toEqual({ lens: { id: "hub", available: true }, ceiling: 40_000 });

    writeProjectConfig({ features: { web: { sidecar: true } }, web: { sidecarContextCeiling: { hub: 60_000 } } });
    expect((await (await get(host, "/lens")).json()).ceiling).toBe(60_000);
  });

  it("refuses the lens read through the web.sidecar gate while the host has it off, as the hub's probe expects", async () => {
    writeProjectConfig({ features: { web: { sidecar: false } } });
    const host = await startHost(1001, 4321);
    const res = await get(host, "/lens");
    expect(res.status).toBe(403);
    expect(res.headers.get("x-ndx-feature-disabled")).toBe("web.sidecar");
  });

  it("counts the snapshot items the next turn marks Δ, without moving the session's fingerprints", async () => {
    const host = await startHost(1001, 4321);
    expect(await (await get(host, "/snapshot")).json()).toEqual({ session: null, changed: null });

    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    // Nothing to be Δ against until a turn has delivered a snapshot.
    expect(await (await get(host, "/snapshot")).json()).toEqual({ session: session.id, changed: null });

    await turn(host, session.id, "first");
    expect(await (await get(host, "/snapshot")).json()).toMatchObject({ session: session.id, changed: 0, omitted: 0 });

    worktrees = [{ path: "/r/app/wt", branch: "feat/x", isAnchor: false, dirtyFiles: 2, runs: { running: 1, latest: null } }];
    const snapshotPath = join(hubSidecarDir(home), `${session.id}.snapshot.json`);
    const delivered = readFileSync(snapshotPath, "utf-8");
    const changed = (await (await get(host, "/snapshot")).json()).changed;
    expect(changed).toBeGreaterThan(0);
    // Reading it is not a turn: the same Δ is still there to read, and to send.
    expect((await (await get(host, "/snapshot")).json()).changed).toBe(changed);
    expect(readFileSync(snapshotPath, "utf-8")).toBe(delivered);
  });

  it("names why there is no snapshot when no hub is running", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "first");
    rmSync(join(home, HUB_PID_FILE));
    const body = await (await get(host, "/snapshot")).json();
    expect(body.changed).toBeNull();
    expect(body.error).toContain("no hub is running");
  });
});

describe("the hub context ceiling", () => {
  it("checkpoints a turn that ends above 40k, and the next turn starts cold from a fresh snapshot", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "BIG question");
    expect(prompts.at(-1)).toBe(HUB_CHECKPOINT_PROMPT);
    expect(HUB_CHECKPOINT_PROMPT).toContain("decision-needed");
    const stored = (await (await hubApi(host, `/${session.id}`)).json()).session;
    expect(stored.refresh).toEqual({ contextTokens: 50_000, ceiling: 40_000 });

    await turn(host, session.id, "next");
    const cold = prompts.at(-1)!;
    expect(cold).toContain("context was refreshed");
    expect(cold).toContain("## Hub snapshot");
  });

  it("follows web.sidecarContextCeiling.hub in the host's config", async () => {
    writeProjectConfig({ features: { web: { sidecar: true } }, web: { sidecarContextCeiling: { hub: 60_000 } } });
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "BIG question");
    expect(prompts).toHaveLength(1);
    expect((await (await hubApi(host, `/${session.id}`)).json()).session.refresh).toBeUndefined();
  });
});

describe("the hub session's broker", () => {
  it("serves only the hub's four tools on its own mcp route while a turn runs", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await hubApi(host, `/${session.id}/turns`, { method: "POST", body: { prompt: "HANG" } })).status).toBe(202);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));

    const client = new Client({ name: "test-cli", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${host.baseUrl}/api/sidecar/hub/sessions/${session.id}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["draft_github_post", "ledger_append", "run_command", "save_draft"]);
    await client.close();
  });
});

describe("the hub ledger", () => {
  const at = "2026-11-02T00:00:00.000Z";

  it("is <ndx home>/hub/ledger.jsonl, which the hub broker's ledger_append writes with decision-needed and never handoff", () => {
    const broker = createAnnouncingBroker(hubSidecarDir(home), () => {}, hubLedgerTarget(home));
    broker.appendLedger("s-1", "decision-needed", "the timeout for an undecided card");
    broker.appendLedger("s-1", "decision", "layer 1 merges first");
    expect(() => broker.appendLedger("s-1", "handoff", "not the agent's")).toThrow(/handoff ledger entry is not one this session writes/);
    expect(readLedgerAt(join(home, "hub", "ledger.jsonl")).map((e) => e.type)).toEqual(["decision-needed", "decision"]);
    expect(existsSync(join(hubSidecarDir(home), "s-1.ledger.jsonl"))).toBe(false);
    // A worktree session's agent has no decision-needed.
    const worktree = createAnnouncingBroker(join(root, "wt-sidecar"), () => {});
    expect(() => worktree.appendLedger("w-1", "decision-needed", "x")).toThrow();
  });

  it("is carried into the cold turn after a checkpoint", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "BIG question");
    expect(prompts.at(-1)).toBe(HUB_CHECKPOINT_PROMPT);
    // What the checkpoint's ledger_append calls leave.
    appendLedgerEntryAt(hubLedgerPath(home), { at, type: "decision-needed", text: "pick the card timeout" });

    await turn(host, session.id, "next");
    const cold = prompts.at(-1)!;
    expect(cold).toContain("context was refreshed");
    expect(cold).toContain("## Session ledger\n- [decision-needed] pick the card timeout");
  });

  it("is carried by the first turn after a host restart, and by a hub session opened after the last one ended", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "first");
    appendLedgerEntryAt(hubLedgerPath(home), { at, type: "unfinished", text: "review layer 2 once layer 1 is green" });

    alive.delete(1001);
    const next = await startHost(2002, 5555);
    await turn(next, session.id, "where were we?");
    expect(prompts.at(-1)).toContain("- [unfinished] review layer 2 once layer 1 is green");

    await hubApi(next, `/${session.id}/end`, { method: "POST" });
    const { session: fresh } = await (await hubApi(next, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect(fresh.id).not.toBe(session.id);
    await turn(next, fresh.id, "new week");
    expect(prompts.at(-1)).toContain("- [unfinished] review layer 2 once layer 1 is green");
  });
});

describe("Open in worktree sidecar", () => {
  const handoff = (server: RouteTestServer, body: unknown): Promise<Response> =>
    fetch(`${server.baseUrl}/api/sidecar/hub/handoff`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    workspaces = { anchor: "main", workspaces: [{ key: "main", path: "/r/app" }, { key: "feat", path: "/r/app/feat" }] };
  });

  it("hands the hub's latest question to the worktree's server through the hub, and answers the address that opens its drawer", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    expect((await handoff(host, { project: "app", worktree: "feat" })).status).toBe(409);

    await turn(host, session.id, "why is layer 1 red?");
    const res = await handoff(host, { project: "app", worktree: "feat" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: { id: "wt-session", name: "From the hub" }, created: true, url: "/p/app/w/feat/?sidecar=wt-session" });
    expect(handoffs).toEqual([{ path: "/p/app/w/feat/api/sidecar/handoff", body: { question: "why is layer 1 red?", vendor: "claude" } }]);

    // The anchor has no /w/ slot.
    expect((await (await handoff(host, { project: "app", worktree: "main" })).json()).url).toBe("/p/app/?sidecar=wt-session");
    expect((await handoff(host, { project: "app", worktree: "gone" })).status).toBe(404);
    // The hub ledger is the agent's alone.
    expect(existsSync(hubLedgerPath(home))).toBe(false);
  });

  it("lists the snapshot's worktrees for the drawer once a turn has read it", async () => {
    worktrees = [{ path: "/r/app/feat", branch: "feat/x", isAnchor: false, dirtyFiles: 0, runs: { running: 0, latest: null } }];
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "first");
    const body = await (await fetch(`${host.baseUrl}/api/sidecar/hub/snapshot`)).json();
    expect(body.worktrees).toEqual([{ project: "app", projectName: "app", key: "feat", branch: "feat/x", changed: false }]);
  });
});

describe("a worktree's handoff and notes routes", () => {
  let wtMessages: SidecarFramesMessage[];
  const brokers = new Map<string, SidecarBroker>();
  const registries = new Map<string, SidecarSessionRegistry>();

  async function startWorktree(): Promise<RouteTestServer> {
    wtMessages = [];
    const server = await startRouteTestServer((req: IncomingMessage, res: ServerResponse) =>
      handleSidecarRoute(req, res, ctx, (m) => { wtMessages.push(m as SidecarFramesMessage); }, {
        registryFor: (projectDir) => {
          let registry = registries.get(projectDir);
          if (!registry) {
            const dir = worktreeSidecarDir(projectDir);
            registry = new SidecarSessionRegistry({
              dir,
              connect: () => ({ spawn: fakeSpawn }),
              context: { ceiling: () => 1_000_000, ledger: (r) => readLedger(dir, r.id), packet: async () => undefined },
            });
            registries.set(projectDir, registry);
          }
          return registry;
        },
        brokerFor: (projectDir) => {
          let broker = brokers.get(projectDir);
          if (!broker) {
            broker = new SidecarBroker({ dir: worktreeSidecarDir(projectDir) });
            brokers.set(projectDir, broker);
          }
          return broker;
        },
      }));
    servers.push(server);
    return server;
  }

  afterEach(() => {
    brokers.clear();
    registries.clear();
  });

  const post = (server: RouteTestServer, path: string, body: unknown): Promise<Response> =>
    fetch(`${server.baseUrl}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

  it("creates a session when none is open, resumes the latest open one after, and its next turn carries the handoff", async () => {
    const wt = await startWorktree();
    const first = await post(wt, "/api/sidecar/handoff", { question: "why is layer 1 red?", vendor: "claude" });
    expect(first.status).toBe(201);
    const made = await first.json();
    expect(made).toMatchObject({ session: { name: "From the hub" }, created: true });

    const again = await post(wt, "/api/sidecar/handoff", { question: "and layer 2?", vendor: "claude" });
    expect(again.status).toBe(200);
    expect((await again.json()).session.id).toBe(made.session.id);

    const dir = worktreeSidecarDir(ctx.projectDir);
    expect(readLedger(dir, made.session.id).map((e) => [e.type, e.text])).toEqual([
      ["handoff", "The hub session handed this over. Its question: why is layer 1 red?"],
      ["handoff", "The hub session handed this over. Its question: and layer 2?"],
    ]);

    const from = wtMessages.length;
    expect((await post(wt, `/api/sidecar/sessions/${made.session.id}/turns`, { prompt: "go on" })).status).toBe(202);
    await vi.waitFor(() => expect(wtMessages.slice(from).some((m) => !m.running)).toBe(true));
    expect(prompts.at(-1)).toContain("## Session ledger\n- [handoff] The hub session handed this over. Its question: why is layer 1 red?");
    expect(prompts.at(-1)).toContain("## Operator's message\ngo on");
  });

  it("cuts a long question to the ledger's entry cap and refuses an empty one", async () => {
    const wt = await startWorktree();
    expect((await post(wt, "/api/sidecar/handoff", { question: " ", vendor: "claude" })).status).toBe(400);
    const { session } = await (await post(wt, "/api/sidecar/handoff", { question: "q".repeat(400), vendor: "claude" })).json();
    const [entry] = readLedger(worktreeSidecarDir(ctx.projectDir), session.id);
    expect(entry!.text).toHaveLength(240);
    expect(entry!.text.endsWith("…")).toBe(true);
  });

  it("reads each open session's latest unfinished and decision notes", async () => {
    const wt = await startWorktree();
    const { session } = await (await post(wt, "/api/sidecar/handoff", { question: "q", vendor: "claude" })).json();
    const broker = brokers.get(ctx.projectDir)!;
    broker.appendLedger(session.id, "unfinished", "old");
    broker.appendLedger(session.id, "decision", "start_work is never allow-listed");
    broker.appendLedger(session.id, "unfinished", "decide the card timeout");
    broker.appendLedger(session.id, "gotcha", "not shown");

    const body = await (await fetch(`${wt.baseUrl}/api/sidecar/ledger/latest`)).json();
    expect(body.sessions).toEqual([{
      id: session.id,
      name: "From the hub",
      unfinished: expect.objectContaining({ type: "unfinished", text: "decide the card timeout" }),
      decision: expect.objectContaining({ type: "decision", text: "start_work is never allow-listed" }),
    }]);
  });
});
