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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { HUB_PID_FILE, hubSessionHostLockPath, hubSidecarDir, readHubSessionHostLock } from "../../../src/hub/index.js";
import { enforceRouteFeatureGate } from "../../../src/server/route-feature-gates.js";
import { handleSidecarRoute, hubSidecarContextOptions, type SidecarFramesMessage } from "../../../src/server/routes-sidecar.js";
import { CHECKPOINT_PROMPT } from "../../../src/server/sidecar/context-refresh.js";
import { SidecarSessionRegistry, type SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
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

/** Claude stand-in that records each prompt. An operator turn containing BIG reports 50k tokens of context. */
const fakeSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  spawns += 1;
  const r = args.indexOf("--resume");
  const id = r >= 0 ? args[r + 1] : `vendor-${spawns}`;
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out = (o: unknown): void => { stdout.write(JSON.stringify(o) + "\n"); };
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null, kill: () => true });
  let prompt = "";
  stdin.on("data", (chunk: Buffer) => { prompt += chunk.toString(); });
  stdin.on("end", () => {
    prompts.push(prompt);
    // A cold prompt quotes the BIG exchange verbatim; only the operator's own BIG turn is big.
    const input = prompt.includes("BIG") && !prompt.includes(CHECKPOINT_PROMPT) && !prompt.includes("context was refreshed") ? 50_000 : 100;
    out({ type: "system", subtype: "init", session_id: id });
    out({ type: "assistant", session_id: id, message: { id: `m-${spawns}`, content: [{ type: "text", text: "ok" }], usage: { input_tokens: input, output_tokens: 4 } } });
    out({ type: "result", session_id: id, result: failTurns ? "not logged in" : "ok", ...(failTurns && { is_error: true }) });
    stdout.end();
    Object.assign(child, { exitCode: failTurns ? 1 : 0 });
    setImmediate(() => { child.emit("exit", 0, null); child.emit("close", 0, null); });
  });
  return child as unknown as ChildProcess;
};

/** The hub's API and one healthy project behind it. */
const fakeHubFetch = (async (url: string) => {
  const path = url.slice(HUB_BASE.length);
  const answers: Record<string, unknown> = {
    "/api/hub/overview": { projects: [{ id: "app", name: "app", repoRoot: "/r/app", url: "/p/app/", state: "healthy", port: null, reachable: true, error: null, branch: "main", dirtyFiles: 0, activeRuns: 0, percentComplete: null, nextTaskTitle: null, analyzedAt: null, repoName: null, remoteHost: null, readiness: null, infrastructure: null }] },
    "/api/hub/queue": { entries: [], dropped: [], running: 0, freeMemoryBytes: null, availableBytes: null, pressure: "unknown", limits: { maxSessions: 4, memoryFloorBytes: 0 }, memoryPaused: false },
    "/p/app/api/status": { rex: { exists: true, layout: "v2" } },
    "/p/app/api/hench/concurrency": { totalRunning: 0, maxConcurrent: 3 },
    "/p/app/api/workspaces": { anchor: "main", workspaces: [] },
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

/** A project server whose hub-session routes run as `pid` on `port`. */
async function startHost(pid: number, port: number): Promise<RouteTestServer> {
  const hostCtx: ServerContext = { ...ctx, port };
  const server = await startRouteTestServer((req: IncomingMessage, res: ServerResponse) => {
    // As start.ts does: the feature gate runs before any route.
    if (enforceRouteFeatureGate(req, res, hostCtx)) return Promise.resolve(true);
    return handleSidecarRoute(req, res, hostCtx, (m) => { messages.push(m as SidecarFramesMessage); }, {
      hub: {
        homeDir: home,
        pid,
        isAlive: (p) => alive.has(p),
        fetch: fakeHubFetch,
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
  failTurns = false;
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

describe("the hub context ceiling", () => {
  it("checkpoints a turn that ends above 40k, and the next turn starts cold from a fresh snapshot", async () => {
    const host = await startHost(1001, 4321);
    const { session } = await (await hubApi(host, "", { method: "POST", body: { vendor: "claude" } })).json();
    await turn(host, session.id, "BIG question");
    expect(prompts.at(-1)).toBe(CHECKPOINT_PROMPT);
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
