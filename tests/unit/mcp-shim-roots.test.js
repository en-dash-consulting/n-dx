/**
 * The MCP shim's bridge following the client's MCP roots (#499).
 *
 * Claude desktop launches a worktree session's project MCP servers in the main
 * checkout, so the workspace the shim derives from cwd names the wrong tree.
 * The client's `roots/list` names the right one. The hub binds a session's
 * workspace at `initialize`, so re-targeting means re-opening the session —
 * invisibly to the client.
 *
 * Driven with in-memory streams, a fake fetch standing in for the hub, and a
 * fake resolveRepo standing in for git.
 */

import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bridgeStdio, workspaceFromRoots } from "../../packages/core/mcp-shim.js";

const REPO = resolve("/repos/app");
const WORKTREE_B = resolve("/repos/app/.claude/worktrees/b");
const OTHER_REPO = resolve("/repos/other");
const URL_ = "http://127.0.0.1:3117/p/app/mcp/rex";

/** git, as far as these tests need it. */
function fakeResolveRepo(dir) {
  if (dir.startsWith(WORKTREE_B)) return { isRepo: true, repoRoot: REPO, worktree: WORKTREE_B };
  if (dir.startsWith(REPO)) return { isRepo: true, repoRoot: REPO, worktree: REPO };
  if (dir.startsWith(OTHER_REPO)) return { isRepo: true, repoRoot: OTHER_REPO, worktree: OTHER_REPO };
  return { isRepo: false, repoRoot: dir, worktree: dir };
}

const rootsOf = (...dirs) => dirs.map((dir) => ({ uri: pathToFileURL(dir).href, name: "root" }));

/**
 * A bridge between a scripted client and a fake hub.
 *
 * @param {object} opts
 * @param {() => object[]|null} opts.roots  What the client answers roots/list with; null = never answers.
 */
function harness({ roots = () => null, workspace = null, rootsTimeoutMs = 1_000, refuseWorkspace } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  /** Every request the hub received. */
  const calls = [];
  /** Every frame the client received. */
  const frames = [];
  const logs = [];
  let sessions = 0;

  const fetchImpl = async (_url, init) => {
    const message = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, headers: init.headers, message });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (refuseWorkspace && init.headers["X-Ndx-Workspace"] === refuseWorkspace) {
      return new Response("unknown workspace", { status: 503 });
    }
    const headers = { "content-type": "application/json" };
    if (message.method === "initialize") headers["mcp-session-id"] = `S${sessions++}`;
    const result = { workspace: init.headers["X-Ndx-Workspace"] ?? null };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { status: 200, headers });
  };

  createInterface({ input: output }).on("line", (line) => {
    const frame = JSON.parse(line);
    frames.push(frame);
    if (frame.method === "roots/list") {
      const answer = roots();
      if (answer) input.write(`${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { roots: answer } })}\n`);
    }
  });

  const done = bridgeStdio({
    url: URL_,
    workspace,
    repoRoot: REPO,
    input,
    output,
    fetchImpl,
    rootsTimeoutMs,
    resolveRepoImpl: fakeResolveRepo,
    log: (m) => logs.push(m),
  });

  const send = (message) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

  /** Wait until the client has received a response with this id. */
  async function responseTo(id) {
    for (let i = 0; i < 400; i++) {
      const frame = frames.find((f) => f.id === id && f.method === undefined);
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no response to ${id}`);
  }

  /** Wait until the shim has sent the client a request for `method`. */
  async function request(method) {
    for (let i = 0; i < 400; i++) {
      const frame = frames.find((f) => f.method === method);
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no ${method} request`);
  }

  /** initialize → initialized, as Claude Code does it. */
  async function handshake({ withRoots = true } = {}) {
    send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: withRoots ? { roots: { listChanged: true } } : {} },
    });
    await responseTo(1);
    send({ method: "notifications/initialized" });
  }

  async function finish() {
    input.end();
    await done;
  }

  const posts = () => calls.filter((c) => c.method === "POST");
  const deletes = () => calls.filter((c) => c.method === "DELETE");

  return { send, responseTo, request, handshake, finish, calls, frames, logs, posts, deletes };
}

describe("workspaceFromRoots", () => {
  it("names a worktree of the target repository by its basename, and the anchor as null", () => {
    expect(workspaceFromRoots(rootsOf(WORKTREE_B), REPO, fakeResolveRepo)).toMatchObject({ workspace: "b" });
    expect(workspaceFromRoots(rootsOf(resolve(WORKTREE_B, "src")), REPO, fakeResolveRepo)).toMatchObject({ workspace: "b" });
    expect(workspaceFromRoots(rootsOf(REPO), REPO, fakeResolveRepo)).toMatchObject({ workspace: null });
  });

  it("uses the first file: root", () => {
    const roots = [{ uri: "https://example.com/x" }, ...rootsOf(WORKTREE_B, REPO)];
    expect(workspaceFromRoots(roots, REPO, fakeResolveRepo)).toMatchObject({ workspace: "b" });
  });

  it("skips no roots, another repository, and a non-repository", () => {
    expect(workspaceFromRoots([], REPO, fakeResolveRepo)).toHaveProperty("skip");
    expect(workspaceFromRoots(undefined, REPO, fakeResolveRepo)).toHaveProperty("skip");
    expect(workspaceFromRoots(rootsOf(OTHER_REPO), REPO, fakeResolveRepo)).toHaveProperty("skip");
    expect(workspaceFromRoots(rootsOf(resolve("/tmp/loose")), REPO, fakeResolveRepo)).toHaveProperty("skip");
  });
});

describe("bridgeStdio following the client's roots", () => {
  it("re-opens the hub session on the worktree the client's root names", async () => {
    const h = harness({ roots: () => rootsOf(WORKTREE_B) });
    await h.handshake();
    h.send({ id: 2, method: "tools/call", params: { name: "add_item" } });
    const reply = await h.responseTo(2);
    await h.finish();

    // Served by a session bound to B.
    expect(reply.result.workspace).toBe("b");
    const call = h.posts().find((p) => p.message.id === 2);
    expect(call.headers["X-Ndx-Workspace"]).toBe("b");
    expect(call.headers["Mcp-Session-Id"]).toBe("S1");

    // The replayed handshake: a fresh session on B, then initialized on it.
    const inits = h.posts().filter((p) => p.message.method === "initialize");
    expect(inits).toHaveLength(2);
    expect(inits[1].headers["Mcp-Session-Id"]).toBeUndefined();
    expect(inits[1].headers["X-Ndx-Workspace"]).toBe("b");
    const acks = h.posts().filter((p) => p.message.method === "notifications/initialized");
    expect(acks.map((a) => a.headers["Mcp-Session-Id"])).toEqual(["S0", "S1"]);

    // One session as far as the client knows.
    expect(h.frames.filter((f) => f.id === 1)).toHaveLength(1);
    // The shim's roots exchange stays between it and the client.
    expect(h.posts().some((p) => String(p.message.id).startsWith("ndx-shim-roots-"))).toBe(false);
    expect(h.posts().some((p) => p.message.method === "roots/list")).toBe(false);

    // S0 released when B took over; S1 released at the end.
    expect(h.deletes().map((d) => d.headers["Mcp-Session-Id"])).toEqual(["S0", "S1"]);
    expect(h.logs.some((l) => l.includes("workspace b, from client root"))).toBe(true);
  });

  it("holds frames sent before the client answers roots/list", async () => {
    const h = harness({ roots: () => null });
    await h.handshake();
    // Sent while the shim is waiting on roots/list.
    h.send({ id: 2, method: "tools/list" });

    // The client answers behind the held frame — the line handler, not the
    // chain, must see it, or the chain waits on itself.
    const ask = await h.request("roots/list");
    h.send({ id: ask.id, result: { roots: rootsOf(WORKTREE_B) } });
    const reply = await h.responseTo(2);
    await h.finish();
    expect(reply.result.workspace).toBe("b");

    // Held, not raced: it reached the hub only after the session moved to B.
    const order = h.posts().map((p) => p.message.id ?? p.message.method);
    const reopened = h.posts().findLastIndex((p) => p.message.method === "initialize");
    expect(order.indexOf(2)).toBeGreaterThan(reopened);
  });

  it("leaves a client without roots exactly as before", async () => {
    const h = harness({ roots: () => rootsOf(WORKTREE_B) });
    await h.handshake({ withRoots: false });
    h.send({ id: 2, method: "tools/list" });
    const reply = await h.responseTo(2);
    await h.finish();

    expect(h.frames.some((f) => f.method === "roots/list")).toBe(false);
    expect(reply.result.workspace).toBeNull();
    expect(h.posts().filter((p) => p.message.method === "initialize")).toHaveLength(1);
    expect(h.deletes().map((d) => d.headers["Mcp-Session-Id"])).toEqual(["S0"]);
  });

  it("keeps the session when the root is the worktree it already serves", async () => {
    const h = harness({ roots: () => rootsOf(REPO) });
    await h.handshake();
    h.send({ id: 2, method: "tools/list" });
    await h.responseTo(2);
    await h.finish();

    expect(h.posts().filter((p) => p.message.method === "initialize")).toHaveLength(1);
    expect(h.logs).toEqual([]);
  });

  it("keeps the session, with one stderr line, for a root in another repository", async () => {
    const h = harness({ roots: () => rootsOf(OTHER_REPO), workspace: "feature" });
    await h.handshake();
    h.send({ id: 2, method: "tools/list" });
    const reply = await h.responseTo(2);
    await h.finish();

    expect(reply.result.workspace).toBe("feature");
    expect(h.posts().filter((p) => p.message.method === "initialize")).toHaveLength(1);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toContain("outside");
  });

  it("gives up on roots/list after the timeout and drops the late answer", async () => {
    const h = harness({ roots: () => null, rootsTimeoutMs: 40 });
    await h.handshake();
    h.send({ id: 2, method: "tools/list" });
    const reply = await h.responseTo(2);

    const ask = h.frames.find((f) => f.method === "roots/list");
    h.send({ id: ask.id, result: { roots: rootsOf(WORKTREE_B) } });
    h.send({ id: 3, method: "tools/list" });
    const after = await h.responseTo(3);
    await h.finish();

    expect(reply.result.workspace).toBeNull();
    expect(after.result.workspace).toBeNull();
    expect(h.posts().some((p) => p.message.id === ask.id)).toBe(false);
    expect(h.logs.some((l) => l.includes("did not answer roots/list"))).toBe(true);
  });

  it("re-targets on notifications/roots/list_changed, without forwarding it", async () => {
    let current = rootsOf(REPO);
    const h = harness({ roots: () => current });
    await h.handshake();
    h.send({ id: 2, method: "tools/list" });
    expect((await h.responseTo(2)).result.workspace).toBeNull();

    current = rootsOf(WORKTREE_B);
    h.send({ method: "notifications/roots/list_changed" });
    h.send({ id: 3, method: "tools/list" });
    expect((await h.responseTo(3)).result.workspace).toBe("b");
    await h.finish();

    expect(h.posts().some((p) => p.message.method === "notifications/roots/list_changed")).toBe(false);
    expect(h.frames.filter((f) => f.method === "roots/list")).toHaveLength(2);
    expect(h.deletes().map((d) => d.headers["Mcp-Session-Id"])).toEqual(["S0", "S1"]);
  });

  it("stays on the first session when the hub will not open one for the root", async () => {
    const h = harness({ roots: () => rootsOf(WORKTREE_B), refuseWorkspace: "b" });
    await h.handshake();
    h.send({ id: 2, method: "tools/list" });
    const reply = await h.responseTo(2);
    await h.finish();

    expect(reply.result.workspace).toBeNull();
    expect(h.posts().find((p) => p.message.id === 2).headers["Mcp-Session-Id"]).toBe("S0");
    expect(h.logs.some((l) => l.includes("503"))).toBe(true);
  });
});
