/**
 * The hub snapshot: per project PRD layout, worktrees, runs against the
 * limit, the hub queue, open PRs and pending changesets, within 8,000
 * characters, with changed items marked Δ.
 *
 * @see packages/web/src/server/sidecar/hub-snapshot.ts
 */

import { describe, it, expect } from "vitest";
import type { ProjectCard, QueueSnapshot } from "../../../src/hub/index.js";
import type { BranchHealth } from "../../../src/server/branch-health/index.js";
import {
  buildHubSnapshot,
  HUB_SNAPSHOT_CAP,
  type HubSnapshotInput,
  type HubSnapshotState,
  type ProjectReads,
  type SnapshotWorktree,
} from "../../../src/server/sidecar/hub-snapshot.js";

const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = (error: string) => ({ ok: false as const, error });

function card(over: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: "ndx",
    name: "n-dx",
    repoRoot: "/repo",
    url: "/p/ndx/",
    state: "healthy",
    port: 4000,
    reachable: true,
    error: null,
    branch: "main",
    dirtyFiles: 0,
    activeRuns: 1,
    percentComplete: 63,
    nextTaskTitle: null,
    analyzedAt: null,
    repoName: null,
    remoteHost: null,
    readiness: null,
    infrastructure: null,
    ...over,
  };
}

function queue(over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    entries: [],
    dropped: [],
    running: 1,
    freeMemoryBytes: null,
    availableBytes: null,
    pressure: "normal",
    limits: { maxSessions: 4, memoryFloorBytes: 0 },
    memoryPaused: false,
    ...over,
  };
}

function worktree(over: Partial<SnapshotWorktree> = {}): SnapshotWorktree {
  return {
    path: "/repo",
    branch: "main",
    isAnchor: true,
    dirtyFiles: 0,
    runs: { running: 0, latest: { status: "completed", taskTitle: "Old task", diagnosisClass: null } },
    ...over,
  };
}

function health(over: Partial<BranchHealth> = {}): BranchHealth {
  return {
    branch: "feat/x",
    head: "0123456789ab",
    base: "origin/main",
    baseSource: "pr",
    baseNote: null,
    ahead: 4,
    behind: 2,
    conflicts: [{ path: ".rex/changes/a/state.yaml", stages: [1, 2, 3], class: "prd-state", reason: "r", fix: null, otherWorktrees: [] }],
    conflictsUnavailable: null,
    stack: [{ branch: "feat/base", contained: false }],
    github: {
      number: 945,
      url: "https://github.com/o/r/pull/945",
      baseRefName: "feat/base",
      isCrossRepository: false,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      reviewDecision: "APPROVED",
      checks: { total: 9, failing: 1, pending: 2 },
      failing: [],
    },
    githubReason: null,
    githubReads: true,
    githubDeferred: false,
    ...over,
  };
}

function reads(over: Partial<ProjectReads> = {}): ProjectReads {
  return {
    status: ok({ rex: { exists: true, layout: "v2" as const } }),
    concurrency: ok({ totalRunning: 1, maxConcurrent: 3 }),
    workspaces: ok({ anchor: "main", workspaces: [{ key: "main", path: "/repo" }, { key: "feat-x", path: "/repo/wt/x" }] }),
    worktrees: ok([
      worktree(),
      worktree({
        path: "/repo/wt/x",
        branch: "feat/x",
        isAnchor: false,
        dirtyFiles: 3,
        runs: { running: 1, latest: { status: "failed", taskTitle: "Build the thing", diagnosisClass: "test-failure" } },
      }),
    ]),
    claims: ok({ claims: [{ taskId: "a5beb47d-a6c2", taskTitle: "Build the thing", worktreeRoot: "/repo/wt/x" }] }),
    changesets: ok({ changesets: [{ file: "calm.md", packages: [{ name: "@n-dx/web", bump: "patch" as const }], summary: "Fix." }] }),
    branchHealth: {
      main: ok(health({ branch: "main", github: null, githubReason: "no PR", stack: [], ahead: 0, behind: 0, conflicts: [] })),
      "feat-x": ok(health()),
    },
    ...over,
  };
}

function input(over: Partial<HubSnapshotInput> = {}): HubSnapshotInput {
  return {
    overview: ok({ projects: [card()] }),
    queue: ok(queue({ entries: [{ projectId: "ndx", workspace: "feat-x", taskId: "ea48bb24-27cc", mode: "single", enqueuedAt: "2026-11-02T22:59:00.000Z" }] })),
    projects: { ndx: reads() },
    generatedAt: "2026-11-02T23:00:00.000Z",
    ...over,
  };
}

describe("buildHubSnapshot", () => {
  it("shows each project's PRD layout, worktrees, runs against the limit and its hub queue", () => {
    const { text } = buildHubSnapshot(input());
    expect(text).toContain("## n-dx (ndx) · healthy · PRD v2 · 63% complete");
    expect(text).toContain("Active runs: 1 of limit 3");
    expect(text).toContain("Machine: 1 of 4 sessions running · 1 queued · memory normal");
    expect(text).toContain("- 1. task ea48bb24 in feat-x (single)");
    expect(text).toContain("- main [anchor]: main · clean · ahead 0 behind 0 of origin/main · no claim · last run completed \"Old task\"");
    expect(text).toContain(
      "- feat-x: feat/x · 3 dirty · ahead 4 behind 2 of origin/main · claim a5beb47d \"Build the thing\" · last run failed \"Build the thing\" (diagnosis: test-failure)",
    );
  });

  it("flags a v1 PRD as not migrated", () => {
    const { text } = buildHubSnapshot(input({ projects: { ndx: reads({ status: ok({ rex: { exists: true, layout: "v1" } }) }) } }));
    expect(text).toContain("PRD v1 (not migrated)");
  });

  it("says when a project is at its run limit", () => {
    const { text } = buildHubSnapshot(input({ projects: { ndx: reads({ concurrency: ok({ totalRunning: 3, maxConcurrent: 3 }) }) } }));
    expect(text).toContain("Active runs: 3 of limit 3 (AT LIMIT)");
  });

  it("shows each open PR's base, stack and containment, review, checks, mergeability and conflict classes", () => {
    const { text } = buildHubSnapshot(input());
    expect(text).toContain("Open PRs: 1");
    expect(text).toContain(
      "- #945 feat/x → feat/base · stack layer 2, below: feat/base NOT contained · review APPROVED · checks 9 total, 1 failing, 2 pending · mergeable CONFLICTING (DIRTY) · 1 conflict (prd-state ×1)",
    );
  });

  it("says GitHub reads are off for a project instead of guessing at its PRs", () => {
    const off = health({ github: null, githubReads: false, githubReason: "off" });
    const { text } = buildHubSnapshot(input({ projects: { ndx: reads({ branchHealth: { main: ok(off), "feat-x": ok(off) } }) } }));
    expect(text).toContain("Open PRs: GitHub reads are off for this project (web.sidecarGithubReads), so PR facts were not read.");
    expect(text).not.toContain("#945");
  });

  it("flags a major bump and a changeset that mentions 1.0.0", () => {
    const changesets = ok({
      changesets: [
        { file: "big.md", packages: [{ name: "@n-dx/core", bump: "major" as const }], summary: "Break it." },
        { file: "freeze.md", packages: [{ name: "@n-dx/rex", bump: "patch" as const }], summary: "Prepare 1.0.0." },
        { file: "calm.md", packages: [{ name: "@n-dx/web", bump: "patch" as const }], summary: "Fix." },
      ],
    });
    const { text } = buildHubSnapshot(input({ projects: { ndx: reads({ changesets }) } }));
    expect(text).toContain("Pending changesets: 3");
    expect(text).toContain("- big.md: @n-dx/core major · ⚠ MAJOR bump");
    expect(text).toContain("- freeze.md: @n-dx/rex patch · ⚠ mentions 1.0.0");
    expect(text).toMatch(/^- calm\.md: @n-dx\/web patch$/m);
  });

  it("keeps an unreachable project, marked with its error, and still builds every other project", () => {
    const { text } = buildHubSnapshot(input({
      overview: ok({ projects: [card({ id: "dead", name: "dead", reachable: false, state: "unreachable", error: "ECONNREFUSED" }), card()] }),
    }));
    expect(text).toContain("## dead (dead) · unreachable · UNREACHABLE: ECONNREFUSED");
    expect(text).toContain("## n-dx (ndx) · healthy · PRD v2");
    expect(text).toContain("- #945 feat/x");
  });

  it("names a read that failed where it failed and keeps the rest of the project", () => {
    const { text } = buildHubSnapshot(input({ projects: { ndx: reads({ changesets: fail("HTTP 404 from /p/ndx/api/changesets") }) } }));
    expect(text).toContain("Pending changesets: not read: HTTP 404 from /p/ndx/api/changesets");
    expect(text).toContain("Worktrees: 2");
  });

  it("marks with Δ exactly the items that changed since the previous snapshot", () => {
    const first = buildHubSnapshot(input());
    expect(first.changed).toEqual([]);
    expect(first.text).not.toMatch(/^\s*-? ?Δ /m);

    const worktrees = ok([
      worktree(),
      worktree({
        path: "/repo/wt/x",
        branch: "feat/x",
        isAnchor: false,
        dirtyFiles: 5,
        runs: { running: 1, latest: { status: "failed", taskTitle: "Build the thing", diagnosisClass: "test-failure" } },
      }),
    ]);
    const second = buildHubSnapshot(input({ projects: { ndx: reads({ worktrees }) } }), first.state);

    expect(second.changed).toEqual(["worktree:ndx:/repo/wt/x"]);
    expect(second.text).toContain("- Δ feat-x: feat/x · 5 dirty");
    expect(second.text).toContain("- main [anchor]: main · clean");
    expect(second.text).not.toContain("Δ main");
    expect(second.text).toContain("- #945 feat/x");
    expect(second.text).not.toContain("Δ #945");
    expect(second.text).toContain("Δ marks an item that changed since the previous snapshot.");
  });

  it("names items that are gone since the previous snapshot", () => {
    const first = buildHubSnapshot(input());
    const second = buildHubSnapshot(input({ queue: ok(queue()) }), first.state);
    expect(second.text).toContain("Gone since the previous snapshot: queue:ndx:feat-x:ea48bb24-27cc");
  });

  it("stays within 8,000 characters by dropping the lowest-priority items and says how many it left out", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      worktree({ path: `/repo/wt/${i}`, branch: `feat/branch-number-${i}`, isAnchor: false, runs: { running: 0, latest: null } }));
    const changesets = ok({
      changesets: [
        { file: "big.md", packages: [{ name: "@n-dx/core", bump: "major" as const }], summary: "x" },
        ...Array.from({ length: 40 }, (_, i) => ({ file: `c${i}.md`, packages: [{ name: "@n-dx/web", bump: "patch" as const }], summary: "x" })),
      ],
    });
    const { text, omitted } = buildHubSnapshot(input({ projects: { ndx: reads({ worktrees: ok([...many, worktree({ path: "/repo/wt/x", branch: "feat/x", isAnchor: false, dirtyFiles: 3 })]), changesets }) } }));

    expect(text.length).toBeLessThanOrEqual(HUB_SNAPSHOT_CAP);
    expect(omitted).toBeGreaterThan(0);
    expect(text).toMatch(new RegExp(`\\[${omitted} items left out to stay within 8,000 characters: .*worktree`));
    // Release flags, the busy worktree and the PR outrank idle worktrees.
    expect(text).toContain("- big.md: @n-dx/core major · ⚠ MAJOR bump");
    expect(text).toContain("- feat-x: feat/x · 3 dirty");
    expect(text).toContain("- #945 feat/x");
    expect(text).not.toContain("feat/branch-number-119");
  });

  describe("worktree session notes", () => {
    const at = "2026-11-02T00:00:00.000Z";
    const notes = (unfinished: string) => ok({
      sessions: [
        { id: "s-1", name: "broker tool shapes", unfinished: { at, type: "unfinished" as const, text: unfinished }, decision: { at, type: "decision" as const, text: "start_work is never allow-listed" } },
        { id: "s-2", name: "zone questions", decision: { at, type: "decision" as const, text: "keep the cursor in the index" } },
      ],
    });

    it("shows each session's latest unfinished and decision notes under its worktree, and marks a change Δ", () => {
      const first = buildHubSnapshot(input({ projects: { ndx: reads({ sessionNotes: { "feat-x": notes("decide the card timeout"), main: ok(null) } }) } }));
      expect(first.text).toContain(
        "  - Sidecar \"broker tool shapes\": unfinished: decide the card timeout · decision: start_work is never allow-listed",
      );
      expect(first.text).toContain("  - Sidecar \"zone questions\": decision: keep the cursor in the index");
      // Under feat-x's own line, not the anchor's.
      expect(first.text.indexOf("Sidecar \"broker tool shapes\"")).toBeGreaterThan(first.text.indexOf("- feat-x:"));

      const next = buildHubSnapshot(
        input({ projects: { ndx: reads({ sessionNotes: { "feat-x": notes("write the divider"), main: ok(null) } }) } }),
        first.state,
      );
      expect(next.text).toContain("  - Δ Sidecar \"broker tool shapes\": unfinished: write the divider");
      expect(next.changed).toEqual(["notes:ndx:/repo/wt/x:s-1"]);
      expect(next.worktrees.find((w) => w.key === "feat-x")).toMatchObject({ project: "ndx", branch: "feat/x", changed: true });
      expect(next.worktrees.find((w) => w.key === "main")).toMatchObject({ changed: false });
    });

    it("names a notes read that failed, and drops notes before the worktrees to stay within the cap", () => {
      const failed = buildHubSnapshot(input({ projects: { ndx: reads({ sessionNotes: { "feat-x": fail("HTTP 500") } }) } }));
      expect(failed.text).toContain("  - Sidecar notes not read: HTTP 500");

      const worktrees = Array.from({ length: 30 }, (_, i) =>
        worktree({ path: `/repo/wt/${i}`, branch: `feat/${i}`, isAnchor: false, dirtyFiles: 1, runs: { running: 0, latest: null } }));
      const workspaces = ok({ anchor: "main", workspaces: worktrees.map((w, i) => ({ key: `k${i}`, path: w.path })) });
      const long = "x".repeat(230);
      const sessionNotes = Object.fromEntries(worktrees.map((_, i) => [`k${i}`, notes(long)]));
      const { text, omitted } = buildHubSnapshot(input({ projects: { ndx: reads({ worktrees: ok(worktrees), workspaces, sessionNotes, branchHealth: {} }) } }));
      expect(text.length).toBeLessThanOrEqual(HUB_SNAPSHOT_CAP);
      expect(omitted).toBeGreaterThan(0);
      expect(text).toMatch(/left out to stay within 8,000 characters: .*\d+ session notes/);
      // Every busy worktree's line outlasts the notes.
      for (let i = 0; i < 30; i += 1) expect(text).toContain(`- k${i}: feat/${i}`);
    });
  });

  it("marks Δ on an item that changed while it was dropped for the cap, and only that item", () => {
    const idle = (name: string, dirtyFiles = 1) =>
      worktree({ path: `/repo/wt/${name}`, branch: `feat/${name}`, isAnchor: false, dirtyFiles, runs: { running: 0, latest: null } });
    const build = (worktrees: SnapshotWorktree[], previous?: HubSnapshotState) =>
      buildHubSnapshot(input({ projects: { ndx: reads({ worktrees: ok(worktrees) }) } }), previous);

    const shown = build([idle("a"), idle("b")]);
    const fillers = Array.from({ length: 300 }, (_, i) => idle(`filler-${i}`));
    const over = build([idle("a"), ...fillers, idle("b", 4)], shown.state);
    expect(over.text.length).toBeLessThanOrEqual(HUB_SNAPSHOT_CAP);
    expect(over.text).not.toContain("feat/a");
    expect(over.text).not.toContain("feat/b");
    expect(over.changed).not.toContain("worktree:ndx:/repo/wt/b");

    const under = build([idle("a"), idle("b", 4)], over.state);
    expect(under.text).toMatch(/Δ [^\n]*feat\/b/);
    expect(under.changed).toEqual(["worktree:ndx:/repo/wt/b"]);
    expect(under.text).toContain("feat/a");
    expect(under.text).not.toMatch(/Δ [^\n]*feat\/a/);
  });
});
