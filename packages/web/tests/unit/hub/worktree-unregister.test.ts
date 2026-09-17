import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hub, normalizeWorktree, loadHubConfig, hubConfigPath, registryPath, loadRegistry } from "../../../src/hub/index.js";
import type { ProjectRecord } from "../../../src/hub/index.js";

/**
 * Unregistering a worktree, and what it means for the project and the hub.
 *
 * The registry is seeded on disk with projects whose servers were never
 * started (`pid`/`port` null), so this exercises the bookkeeping — which
 * worktrees remain, when the project goes, when the hub decides to exit —
 * without spawning a dashboard per case. The end-to-end version, with real
 * child servers, lives in tests/integration/hub-daemon.test.ts.
 */

let home: string;

function seed(projects: ProjectRecord[]): void {
  writeFileSync(
    registryPath(home),
    JSON.stringify({ version: 1, projects: Object.fromEntries(projects.map((p) => [p.id, p])) }),
  );
}

function record(id: string, worktrees: string[]): ProjectRecord {
  return {
    id,
    name: id,
    repoRoot: worktrees[0],
    worktrees,
    ndxBin: "/nonexistent/ndx",
    port: null,
    pid: null,
    lastSeen: null,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hub-unregister-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("normalizeWorktree", () => {
  it("absorbs trailing separators and nothing else", () => {
    expect(normalizeWorktree("/repos/app/")).toBe("/repos/app");
    expect(normalizeWorktree("/repos/app///")).toBe("/repos/app");
    expect(normalizeWorktree("/repos/app\\")).toBe("/repos/app");
    expect(normalizeWorktree("/repos/app")).toBe("/repos/app");
    // A different path stays different — both sides realpath before this point.
    expect(normalizeWorktree("/repos/App")).not.toBe(normalizeWorktree("/repos/app"));
    // Root is not trimmed away to nothing.
    expect(normalizeWorktree("/")).toBe("/");
  });
});

describe("loadHubConfig", () => {
  it("reads hub.port and hub.keepAlive, and ignores everything malformed", () => {
    const path = hubConfigPath(home);
    expect(loadHubConfig(path)).toEqual({});

    writeFileSync(path, JSON.stringify({ hub: { port: 4000, keepAlive: true } }));
    expect(loadHubConfig(path)).toEqual({ port: 4000, keepAlive: true });

    writeFileSync(path, JSON.stringify({ hub: { port: "4000", keepAlive: "yes" } }));
    expect(loadHubConfig(path)).toEqual({});

    writeFileSync(path, JSON.stringify({ hub: { port: 0 } }));
    expect(loadHubConfig(path)).toEqual({});

    writeFileSync(path, "{ not json");
    expect(loadHubConfig(path)).toEqual({});
  });
});

describe("Hub.removeWorktree", () => {
  it("keeps the project while another worktree is registered", async () => {
    seed([record("app", ["/repos/app", "/repos/app/.wt/feature"])]);
    const hub = new Hub({ homeDir: home });

    const result = await hub.removeWorktree("app", "/repos/app/.wt/feature");
    expect(result).toMatchObject({
      projectKnown: true,
      worktreeKnown: true,
      projectRemoved: false,
      remaining: ["/repos/app"],
      hubExiting: false,
    });
    expect(result.project?.id).toBe("app");
    expect(hub.projectCount).toBe(1);
    // Written through, not just held in memory.
    expect(loadRegistry(registryPath(home)).projects.app.worktrees).toEqual(["/repos/app"]);
  });

  it("removing the last worktree unregisters the project and, with nothing left, exits the hub", async () => {
    seed([record("app", ["/repos/app"])]);
    let emptied = 0;
    const hub = new Hub({ homeDir: home, onEmpty: () => { emptied += 1; } });

    const result = await hub.removeWorktree("app", "/repos/app");
    expect(result).toMatchObject({ projectRemoved: true, remaining: [], hubExiting: true });
    expect(result.project).toBeNull();
    expect(hub.projectCount).toBe(0);
    expect(loadRegistry(registryPath(home)).projects).toEqual({});

    // The hook fires only when the route layer says the response has flushed.
    expect(emptied).toBe(0);
    hub.exitIfEmpty();
    expect(emptied).toBe(1);
  });

  it("another project still registered means no exit", async () => {
    seed([record("app", ["/repos/app"]), record("other", ["/repos/other"])]);
    let emptied = 0;
    const hub = new Hub({ homeDir: home, onEmpty: () => { emptied += 1; } });

    const result = await hub.removeWorktree("app", "/repos/app");
    expect(result).toMatchObject({ projectRemoved: true, hubExiting: false });
    expect(hub.projectCount).toBe(1);
    hub.exitIfEmpty();
    expect(emptied).toBe(0);
  });

  it("keepAlive holds the hub open with an empty registry", async () => {
    seed([record("app", ["/repos/app"])]);
    writeFileSync(hubConfigPath(home), JSON.stringify({ hub: { keepAlive: true } }));
    let emptied = 0;
    const hub = new Hub({ homeDir: home, onEmpty: () => { emptied += 1; } });
    expect(hub.keepAlive).toBe(true);

    const result = await hub.removeWorktree("app", "/repos/app");
    expect(result).toMatchObject({ projectRemoved: true, hubExiting: false });
    hub.exitIfEmpty();
    expect(emptied).toBe(0);
  });

  it("an explicit keepAlive option beats the config file", () => {
    writeFileSync(hubConfigPath(home), JSON.stringify({ hub: { keepAlive: true } }));
    expect(new Hub({ homeDir: home, keepAlive: false }).keepAlive).toBe(false);
    expect(new Hub({ homeDir: home }).keepAlive).toBe(true);
  });

  it("matches worktrees regardless of a trailing separator", async () => {
    seed([record("app", ["/repos/app", "/repos/app/.wt/feature"])]);
    const hub = new Hub({ homeDir: home });
    const result = await hub.removeWorktree("app", "/repos/app/.wt/feature/");
    expect(result.worktreeKnown).toBe(true);
    expect(result.remaining).toEqual(["/repos/app"]);
  });

  it("reports an unknown project and an unregistered worktree apart", async () => {
    seed([record("app", ["/repos/app"])]);
    const hub = new Hub({ homeDir: home });

    expect(await hub.removeWorktree("nope", "/repos/app")).toMatchObject({
      projectKnown: false, worktreeKnown: false, projectRemoved: false,
    });
    // A path this project never registered leaves it exactly as it was.
    const stranger = await hub.removeWorktree("app", "/somewhere/else");
    expect(stranger).toMatchObject({ projectKnown: true, worktreeKnown: false, projectRemoved: false });
    expect(stranger.remaining).toEqual(["/repos/app"]);
    expect(hub.projectCount).toBe(1);
  });

  it("exitIfEmpty does nothing while projects remain", async () => {
    seed([record("app", ["/repos/app"])]);
    let emptied = 0;
    const hub = new Hub({ homeDir: home, onEmpty: () => { emptied += 1; } });
    hub.exitIfEmpty();
    expect(emptied).toBe(0);
  });
});
