// @vitest-environment jsdom
/**
 * Tests for the Sessions tray.
 *
 * Covers the two acceptance criteria — the pill and expanded panel render for
 * a multi-worktree repository and are keyboard-reachable like the neighbouring
 * trays, and nothing renders outside a repository or in a single-worktree one
 * — plus the pure helpers behind each cell.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  SessionsPanel,
  branchLabel,
  claimLabel,
  dirtyLabel,
  runLine,
  sessionsPillLabel,
  shouldShowSessions,
  worktreeName,
} from "../../../src/viewer/components/sessions-panel.js";
import type { WorktreeEntry } from "../../../src/viewer/hooks/use-worktrees.js";
import type { ClaimEntry } from "../../../src/viewer/hooks/use-claims.js";
import { claimsForWorktree, indexClaims } from "../../../src/viewer/hooks/use-claims.js";

function makeClaim(overrides: Partial<ClaimEntry> = {}): ClaimEntry {
  return {
    taskId: "task-9",
    taskTitle: "Wire the thing",
    worktreeRoot: "/repo/.claude/worktrees/feature",
    worktree: "feature",
    isServedHere: false,
    pid: 4242,
    host: "box",
    claimedAt: "2026-09-16T10:00:00.000Z",
    expiresAt: "2026-09-16T14:00:00.000Z",
    ...overrides,
  };
}

function makeWorktree(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: "/repo/main",
    branch: "main",
    head: "abc123",
    isAnchor: true,
    isServed: true,
    detached: false,
    bare: false,
    dirty: false,
    dirtyFiles: 0,
    runs: { total: 0, running: 0, lastFinishedAt: null, latest: null },
    server: { pidFile: false, pid: null, port: null },
    ...overrides,
  };
}

const LINKED = makeWorktree({
  path: "/repo/.claude/worktrees/feature",
  branch: "feature",
  isAnchor: false,
  isServed: false,
  dirty: true,
  dirtyFiles: 3,
  runs: {
    total: 2,
    running: 1,
    lastFinishedAt: null,
    latest: {
      id: "run-live",
      status: "running",
      taskTitle: "Sessions panel",
      startedAt: new Date(Date.now() - 62_000).toISOString(),
      finishedAt: null,
    },
  },
});

describe("sessions-panel helpers", () => {
  it("names a worktree by its last path segment", () => {
    expect(worktreeName("/repo/.claude/worktrees/feature")).toBe("feature");
    expect(worktreeName("/repo/main/")).toBe("main");
    expect(worktreeName("C:\\src\\repo")).toBe("repo");
    expect(worktreeName("repo")).toBe("repo");
  });

  it("appends the running count to the pill only when something is running", () => {
    expect(sessionsPillLabel([makeWorktree(), LINKED])).toBe("2 worktrees · 1 running");
    expect(sessionsPillLabel([makeWorktree(), makeWorktree({ path: "/repo/b" })])).toBe("2 worktrees");
    expect(sessionsPillLabel([makeWorktree()])).toBe("1 worktree");
  });

  it("shows only for a repository with more than one worktree", () => {
    expect(shouldShowSessions(null)).toBe(false);
    expect(shouldShowSessions([])).toBe(false);
    expect(shouldShowSessions([makeWorktree()])).toBe(false);
    expect(shouldShowSessions([makeWorktree(), LINKED])).toBe(true);
  });

  it("distinguishes a dirty count, a clean tree, and one git could not report on", () => {
    expect(dirtyLabel(LINKED)).toEqual({ text: "3 uncommitted", tone: "dirty" });
    expect(dirtyLabel(makeWorktree())).toEqual({ text: "clean", tone: "clean" });
    expect(dirtyLabel(makeWorktree({ dirty: null, dirtyFiles: null })))
      .toEqual({ text: "status unknown", tone: "unknown" });
  });

  it("names a branch, or says why there isn't one", () => {
    expect(branchLabel(makeWorktree())).toBe("main");
    expect(branchLabel(makeWorktree({ branch: null, detached: true }))).toBe("detached HEAD");
    expect(branchLabel(makeWorktree({ branch: null, bare: true }))).toBe("bare");
    expect(branchLabel(makeWorktree({ branch: null }))).toBe("no branch");
  });

  describe("runLine", () => {
    it("defers the elapsed time to the caller for a running run", () => {
      const startedAt = "2026-09-16T10:00:00.000Z";
      expect(runLine({ id: "r", status: "running", taskTitle: "Do a thing", startedAt, finishedAt: null }))
        .toEqual({ title: "Do a thing", detail: "running", elapsedFrom: startedAt, tone: "running" });
    });

    it("gives a finished run its status and how long ago it ended", () => {
      const line = runLine({
        id: "r",
        status: "completed",
        taskTitle: "Do a thing",
        startedAt: "2026-09-16T10:00:00.000Z",
        finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      });
      expect(line).toMatchObject({ title: "Do a thing", detail: "completed · 5m ago", tone: "ok" });
      expect(line.elapsedFrom).toBeNull();
    });

    it("tones a failed run apart from a completed one", () => {
      expect(runLine({ id: "r", status: "failed", taskTitle: "t", startedAt: null, finishedAt: null }).tone)
        .toBe("bad");
    });

    it("falls back to the run id when the record has no task title", () => {
      expect(runLine({ id: "run-42", status: "completed", taskTitle: null, startedAt: null, finishedAt: null }).title)
        .toBe("run-42");
    });

    it("says so when a worktree has no runs", () => {
      expect(runLine(null)).toEqual({
        title: "No runs recorded here", detail: "", elapsedFrom: null, tone: "idle",
      });
    });
  });
});

describe("claims helpers", () => {
  it("labels a claim by title, falling back to the task id", () => {
    expect(claimLabel(makeClaim())).toBe("Wire the thing");
    expect(claimLabel(makeClaim({ taskTitle: null }))).toBe("task-9");
  });

  it("selects the claims held from one worktree by its root path", () => {
    const claims = [makeClaim(), makeClaim({ taskId: "x", worktreeRoot: "/repo/main" })];
    expect(claimsForWorktree(claims, "/repo/.claude/worktrees/feature").map((c) => c.taskId)).toEqual(["task-9"]);
    expect(claimsForWorktree(claims, "/nowhere")).toEqual([]);
    expect(claimsForWorktree(null, "/repo/main")).toEqual([]);
  });

  it("indexes claims by task id", () => {
    const byId = indexClaims([makeClaim(), makeClaim({ taskId: "x" })]);
    expect(Object.keys(byId).sort()).toEqual(["task-9", "x"]);
    expect(byId["x"].taskId).toBe("x");
  });
});

describe("SessionsPanel", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing before the first fetch, outside a repo, or for a single worktree", () => {
    for (const worktrees of [null, [], [makeWorktree()]]) {
      render(h(SessionsPanel, { worktrees }), root);
      expect(root.children.length).toBe(0);
    }
  });

  it("renders a collapsed pill naming the worktree and running counts", () => {
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED] }), root);

    const toggle = root.querySelector(".sessions-toggle")!;
    expect(toggle.textContent).toContain("2 worktrees · 1 running");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Keyboard-reachable the same way the other trays are: a real button,
    // labelled, with no list rendered until it is pressed.
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-label")).toContain("show worktree sessions");
    expect(root.querySelector(".sessions-list")).toBeNull();
  });

  it("expands into a row per worktree with branch, dirty state and run", () => {
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED] }), root);
    act(() => { (root.querySelector(".sessions-toggle") as HTMLButtonElement).click(); });

    const rows = root.querySelectorAll(".sessions-row");
    expect(rows.length).toBe(2);
    expect(root.querySelector(".sessions-toggle")!.getAttribute("aria-expanded")).toBe("true");

    const anchor = rows[0];
    expect(anchor.querySelector(".sessions-anchor-star")).not.toBeNull();
    expect(anchor.querySelector(".sessions-name")!.textContent).toBe("main");
    expect(anchor.querySelector(".sessions-branch")!.tagName).toBe("CODE");
    expect(anchor.querySelector(".sessions-branch")!.textContent).toBe("main");
    expect(anchor.querySelector(".sessions-dirty-clean")!.textContent).toBe("clean");
    expect(anchor.querySelector(".sessions-run-title")!.textContent).toBe("No runs recorded here");

    const linked = rows[1];
    expect(linked.querySelector(".sessions-anchor-star")).toBeNull();
    expect(linked.querySelector(".sessions-name")!.textContent).toBe("feature");
    expect(linked.querySelector(".sessions-dirty-dirty")!.textContent).toBe("3 uncommitted");
    expect(linked.querySelector(".sessions-run-title")!.textContent).toBe("Sessions panel");
    // Elapsed time ticks alongside the "running" label.
    expect(linked.querySelector(".sessions-run-detail")!.textContent).toMatch(/^running · 1m \d+s$/);
  });

  it("lists each worktree's claimed tasks under its row, by title or by id, and none when released", () => {
    const claims = [
      makeClaim(),
      makeClaim({ taskId: "task-10", taskTitle: null }),
      makeClaim({ taskId: "task-11", taskTitle: "Anchor task", worktreeRoot: "/repo/main", worktree: "main", isServedHere: true }),
    ];
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED], claims }), root);
    act(() => { (root.querySelector(".sessions-toggle") as HTMLButtonElement).click(); });

    const [anchor, linked] = Array.from(root.querySelectorAll(".sessions-row"));
    const anchorClaims = Array.from(anchor.querySelectorAll(".sessions-claim-title")).map((el) => el.textContent);
    const linkedClaims = Array.from(linked.querySelectorAll(".sessions-claim-title")).map((el) => el.textContent);
    expect(anchorClaims).toEqual(["Anchor task"]);
    // Title when this PRD knows the task, id when it exists only over there.
    expect(linkedClaims).toEqual(["Wire the thing", "task-10"]);
    expect(linked.querySelector(".sessions-claims")!.getAttribute("aria-label")).toBe("Tasks claimed in feature");

    // Released: the line goes.
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED], claims: [] }), root);
    expect(root.querySelector(".sessions-claim")).toBeNull();
    // And before the first claims fetch nothing is asserted either way.
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED], claims: null }), root);
    expect(root.querySelector(".sessions-claim")).toBeNull();
  });

  it("links a worktree's run into the Runs view without switching workspace", () => {
    const navigateTo = vi.fn();
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED], navigateTo }), root);
    act(() => { (root.querySelector(".sessions-toggle") as HTMLButtonElement).click(); });

    const links = root.querySelectorAll(".sessions-run-link");
    // Only the worktree with a run offers one.
    expect(links.length).toBe(1);
    act(() => { (links[0] as HTMLButtonElement).click(); });
    expect(navigateTo).toHaveBeenCalledWith("hench-runs", { runId: "run-live" });
  });

  it("omits the run link when there is nowhere to navigate", () => {
    render(h(SessionsPanel, { worktrees: [makeWorktree(), LINKED] }), root);
    act(() => { (root.querySelector(".sessions-toggle") as HTMLButtonElement).click(); });
    expect(root.querySelectorAll(".sessions-run-link").length).toBe(0);
  });
});
