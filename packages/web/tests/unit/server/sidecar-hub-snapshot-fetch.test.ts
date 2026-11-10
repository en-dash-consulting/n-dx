/**
 * The hub snapshot's reads go through the hub only — its own API and the
 * `/p/<id>/` prefix — with the per-user token, and a failed read stays where
 * it failed.
 *
 * @see packages/web/src/server/sidecar/hub-snapshot-fetch.ts
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_TOKEN_FILENAME } from "@n-dx/llm-client";
import { HUB_PID_FILE } from "../../../src/hub/index.js";
import { fetchHubSnapshotInput, resolveHubAccess } from "../../../src/server/sidecar/hub-snapshot-fetch.js";
import { buildHubSnapshot } from "../../../src/server/sidecar/hub-snapshot.js";

const BASE = "http://127.0.0.1:3117";

function project(id: string, reachable: boolean) {
  return { id, name: id, repoRoot: `/r/${id}`, url: `/p/${id}/`, state: reachable ? "healthy" : "unreachable", port: null, reachable, error: reachable ? null : "ECONNREFUSED", branch: null, dirtyFiles: null, activeRuns: null, percentComplete: null, nextTaskTitle: null, analyzedAt: null, repoName: null, remoteHost: null, readiness: null, infrastructure: null };
}

const ANSWERS: Record<string, unknown> = {
  "/api/hub/overview": { projects: [project("a", true), project("dead", false)] },
  "/api/hub/queue": { entries: [], dropped: [], running: 0, freeMemoryBytes: null, availableBytes: null, pressure: "unknown", limits: { maxSessions: 4, memoryFloorBytes: 0 }, memoryPaused: false },
  "/p/a/api/status": { rex: { exists: true, layout: "v1" } },
  "/p/a/api/hench/concurrency": { totalRunning: 0, maxConcurrent: 3 },
  "/p/a/api/workspaces": { anchor: "main", workspaces: [{ key: "main", path: "/r/a" }, { key: "wt-1", path: "/r/a/wt" }] },
  "/p/a/api/worktrees": [],
  "/p/a/api/rex/claims": { claims: [] },
  "/p/a/api/branch-health?github=1": { github: null, githubReads: false },
  "/p/a/w/wt-1/api/branch-health?github=1": { github: null, githubReads: false },
};

describe("fetchHubSnapshotInput", () => {
  it("reads only hub routes with the token, skips unreachable projects, and keeps a failed read local", async () => {
    const calls: Array<{ url: string; token: string | null }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, token: headers["X-Ndx-Token"] ?? null });
      const path = url.slice(BASE.length);
      if (!(path in ANSWERS)) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(ANSWERS[path]), { status: 200 });
    }) as typeof fetch;

    const got = await fetchHubSnapshotInput({ baseUrl: BASE, token: "tok" }, { fetch: fake, now: () => new Date("2026-11-02T00:00:00Z") });

    expect(calls.every((c) => c.url.startsWith(`${BASE}/api/hub/`) || c.url.startsWith(`${BASE}/p/`))).toBe(true);
    expect(calls.every((c) => c.token === "tok")).toBe(true);
    expect(calls.some((c) => c.url.includes("/p/dead/"))).toBe(false);
    expect(got.projects.a.changesets).toEqual({ ok: false, error: "HTTP 404 from /p/a/api/changesets: nope" });
    expect(got.projects.a.status).toEqual({ ok: true, value: { rex: { exists: true, layout: "v1" } } });
    expect(Object.keys(got.projects.a.branchHealth).sort()).toEqual(["main", "wt-1"]);
    expect(got.generatedAt).toBe("2026-11-02T00:00:00.000Z");

    const { text } = buildHubSnapshot(got);
    expect(text).toContain("## dead (dead) · unreachable · UNREACHABLE: ECONNREFUSED");
    expect(text).toContain("PRD v1 (not migrated)");
  });

  it("reads each worktree's Sidecar notes, and takes a web.sidecar refusal as no sessions rather than a failed read", async () => {
    const notes = { sessions: [{ id: "s-1", name: "n", unfinished: { at: "", type: "unfinished", text: "u" } }] };
    const fake = (async (url: string) => {
      const path = url.slice(BASE.length);
      if (path === "/p/a/api/sidecar/ledger/latest") return new Response(JSON.stringify(notes), { status: 200 });
      if (path === "/p/a/w/wt-1/api/sidecar/ledger/latest") {
        return new Response(JSON.stringify({ error: "off" }), { status: 403, headers: { "X-Ndx-Feature-Disabled": "web.sidecar" } });
      }
      if (!(path in ANSWERS)) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(ANSWERS[path]), { status: 200 });
    }) as typeof fetch;

    const got = await fetchHubSnapshotInput({ baseUrl: BASE, token: null }, { fetch: fake });
    expect(got.projects.a.sessionNotes).toEqual({ main: { ok: true, value: notes }, "wt-1": { ok: true, value: null } });
  });

  it("records a refused connection as that read's error rather than throwing", async () => {
    const fake = (async () => { throw new Error("connect ECONNREFUSED"); }) as typeof fetch;
    const got = await fetchHubSnapshotInput({ baseUrl: BASE, token: null }, { fetch: fake });
    expect(got.overview).toEqual({ ok: false, error: "/api/hub/overview: connect ECONNREFUSED" });
    expect(buildHubSnapshot(got).text).toContain("Projects: hub overview not read: /api/hub/overview: connect ECONNREFUSED");
  });
});

describe("resolveHubAccess", () => {
  let home: string | null = null;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
    home = null;
  });

  it("reads the hub's port from its pid file and the token from the per-user directory", () => {
    home = mkdtempSync(join(tmpdir(), "hub-access-"));
    expect(resolveHubAccess(home)).toBeNull();
    writeFileSync(join(home, HUB_PID_FILE), JSON.stringify({ pid: 1, port: 3999, startedAt: "" }));
    writeFileSync(join(home, AUTH_TOKEN_FILENAME), "secret\n");
    expect(resolveHubAccess(home)).toEqual({ baseUrl: "http://127.0.0.1:3999", token: "secret" });
  });
});
