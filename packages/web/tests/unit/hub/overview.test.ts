import { describe, it, expect } from "vitest";
import { buildHubOverview, toProjectCard, type ChildSnapshot } from "../../../src/hub/overview.js";
import type { ProjectView } from "../../../src/hub/index.js";

/**
 * Joining each child's live status onto the registry.
 *
 * The child fetcher is injected, so the case that matters — one project
 * answering and one not — is exercised without standing up two servers. A
 * hub with several projects routinely has one whose server has died, and the
 * card for it still has to render.
 */

function project(id: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id,
    name: id,
    repoRoot: `/repos/${id}`,
    worktrees: [`/repos/${id}`],
    ndxBin: "/ndx",
    port: 4001,
    pid: 100,
    lastSeen: null,
    status: { state: "healthy", pid: 100, port: 4001, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
    ...overrides,
  } as ProjectView;
}

const HEALTHY: ChildSnapshot = {
  status: {
    rex: { exists: true, percentComplete: 42, nextTaskTitle: "Wire the thing" },
    hench: { activeRuns: 2 },
    sv: { analyzedAt: "2026-09-16T09:00:00.000Z" },
  },
  git: { branch: "feature/x", files: [{ path: "a.ts" }, { path: "b.ts" }] },
  error: null,
};

describe("toProjectCard", () => {
  it("joins a healthy child's answers onto the registry entry", () => {
    const card = toProjectCard(project("alpha"), HEALTHY);
    expect(card).toMatchObject({
      id: "alpha",
      name: "alpha",
      repoRoot: "/repos/alpha",
      url: "/p/alpha/",
      state: "healthy",
      port: 4001,
      reachable: true,
      error: null,
      branch: "feature/x",
      dirtyFiles: 2,
      activeRuns: 2,
      percentComplete: 42,
      nextTaskTitle: "Wire the thing",
      analyzedAt: "2026-09-16T09:00:00.000Z",
    });
  });

  it("renders a card for an unreachable child from the registry alone", () => {
    const card = toProjectCard(
      project("beta", { status: { state: "unreachable", pid: null, port: null, attached: false, respawns: 1, lastHealthAt: null, lastError: null } as never }),
      { status: null, git: null, error: "connect ECONNREFUSED" },
    );
    expect(card).toMatchObject({
      id: "beta",
      name: "beta",
      repoRoot: "/repos/beta",
      url: "/p/beta/",
      state: "unreachable",
      reachable: false,
      error: "connect ECONNREFUSED",
    });
    // Everything the child would have said is absent, not zero.
    expect(card.branch).toBeNull();
    expect(card.dirtyFiles).toBeNull();
    expect(card.activeRuns).toBeNull();
    expect(card.percentComplete).toBeNull();
  });

  it("distinguishes no PRD from a PRD at zero", () => {
    const none = toProjectCard(project("a"), { ...HEALTHY, status: { rex: { exists: false, percentComplete: 0 } } });
    expect(none.percentComplete).toBeNull();

    const zero = toProjectCard(project("a"), { ...HEALTHY, status: { rex: { exists: true, percentComplete: 0 } } });
    expect(zero.percentComplete).toBe(0);
  });

  it("distinguishes a clean tree from one git could not be asked about", () => {
    const clean = toProjectCard(project("a"), { ...HEALTHY, git: { branch: "main", files: [] } });
    expect(clean.dirtyFiles).toBe(0);

    const unknown = toProjectCard(project("a"), { ...HEALTHY, git: null });
    expect(unknown.dirtyFiles).toBeNull();
    expect(unknown.branch).toBeNull();
    // The rest of the card survives a git failure.
    expect(unknown.reachable).toBe(true);
    expect(unknown.activeRuns).toBe(2);
  });

  it("falls back to the supervisor's last error when the child said nothing", () => {
    const card = toProjectCard(
      project("beta", { status: { state: "stopped", pid: null, port: null, attached: false, respawns: 0, lastHealthAt: null, lastError: "spawn ENOENT" } as never }),
      null,
    );
    expect(card.reachable).toBe(false);
    expect(card.error).toBe("spawn ENOENT");
  });
});

describe("buildHubOverview", () => {
  it("asks every project with a port, and joins one healthy and one unreachable child", async () => {
    const asked: number[] = [];
    const overview = await buildHubOverview(
      [
        project("alpha", { port: 4001, status: { state: "healthy", pid: 1, port: 4001, attached: false, respawns: 0, lastHealthAt: null, lastError: null } as never }),
        project("beta", { port: 4002, status: { state: "unreachable", pid: 2, port: 4002, attached: false, respawns: 1, lastHealthAt: null, lastError: null } as never }),
      ],
      async (port) => {
        asked.push(port);
        if (port === 4001) return HEALTHY;
        return { status: null, git: null, error: "HTTP 502 from /api/status" };
      },
      () => new Date("2026-09-16T12:00:00.000Z"),
    );

    expect(asked.sort()).toEqual([4001, 4002]);
    expect(overview.generatedAt).toBe("2026-09-16T12:00:00.000Z");
    expect(overview.projects.map((p) => p.id)).toEqual(["alpha", "beta"]);

    const [alpha, beta] = overview.projects;
    expect(alpha).toMatchObject({ reachable: true, branch: "feature/x", activeRuns: 2, percentComplete: 42 });
    expect(beta).toMatchObject({ reachable: false, error: "HTTP 502 from /api/status", branch: null });
  });

  it("does not ask a project that has no server, and still gives it a card", async () => {
    let asked = 0;
    const overview = await buildHubOverview(
      [project("gone", { port: null, status: { state: "stopped", pid: null, port: null, attached: false, respawns: 0, lastHealthAt: null, lastError: null } as never })],
      async () => { asked++; return HEALTHY; },
    );
    expect(asked).toBe(0);
    expect(overview.projects).toHaveLength(1);
    expect(overview.projects[0]).toMatchObject({ id: "gone", reachable: false, state: "stopped" });
  });

  it("treats a fetcher that throws as an unreachable child, not a failed page", async () => {
    const overview = await buildHubOverview(
      [
        project("alpha"),
        project("beta", { port: 4002, status: { state: "healthy", pid: 2, port: 4002, attached: false, respawns: 0, lastHealthAt: null, lastError: null } as never }),
      ],
      async (port) => {
        if (port === 4001) throw new Error("socket hang up");
        return HEALTHY;
      },
    );
    expect(overview.projects[0]).toMatchObject({ reachable: false, error: "socket hang up" });
    // The other card is unaffected — one bad child must not empty the page.
    expect(overview.projects[1]).toMatchObject({ reachable: true, branch: "feature/x" });
  });

  it("is an empty list, not an error, with nothing registered", async () => {
    expect((await buildHubOverview([])).projects).toEqual([]);
  });
});
