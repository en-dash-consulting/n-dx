// @vitest-environment jsdom
/**
 * The Workspaces Overview board.
 *
 * Two things here are load-bearing and would pass a weaker test suite:
 *
 * 1. **Every per-workspace request names its workspace.** The board is the one
 *    view that reads across worktrees; if a request went out without
 *    `X-Ndx-Workspace` the server would answer for the viewer's own workspace
 *    and every card would show the same numbers — which *looks* fine. So the
 *    fake fetch records the header on every call and the tests assert on it.
 * 2. **A frame about another worktree moves that worktree's card.** Every
 *    other socket consumer filters those frames out; this one must not.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import {
  WorkspacesView,
  buildWorkspaceCards,
  machineStats,
  pickLiveExecution,
  frameWorkspace,
  workspaceViewUrl,
  cardStatus,
  formatBytes,
  type WorkspaceSummary,
  type WorktreeEntry,
  type ExecutionStatus,
  type PrdDeltaCounts,
} from "../../../src/viewer/views/workspaces.js";
import { formatSince } from "../../../src/viewer/utils/format.js";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANCHOR: WorkspaceSummary = { key: "n-dx", path: "/repo", branch: "main", isAnchor: true, active: true };
const BRANCH: WorkspaceSummary = { key: "feature", path: "/repo-feature", branch: "feat/x", isAnchor: false, active: true };

const ANCHOR_TREE: WorktreeEntry = {
  path: "/repo", branch: "main", dirty: false, dirtyFiles: 0,
  runs: { total: 4, running: 0, lastFinishedAt: "2026-09-16T12:00:00.000Z" },
  server: { pidFile: true, pid: 10, port: 3117 },
};
const BRANCH_TREE: WorktreeEntry = {
  path: "/repo-feature", branch: "feat/x", dirty: true, dirtyFiles: 7,
  runs: { total: 2, running: 1, lastFinishedAt: null },
  server: { pidFile: false, pid: null, port: null },
};

const RUNNING: ExecutionStatus = {
  taskId: "task-1", taskTitle: "Wire the delta route", runId: "exec-1",
  status: "running", startedAt: "2026-09-16T12:30:00.000Z",
  lastOutput: "running tests…", tokensPerSecond: 42.5,
};

const DELTA: PrdDeltaCounts = { onlyHere: 3, onlyAnchor: 1, changed: 5, completedHere: 2 };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("buildWorkspaceCards", () => {
  it("joins registry entries to worktrees by path, anchor first", () => {
    const cards = buildWorkspaceCards(
      [BRANCH, ANCHOR], [ANCHOR_TREE, BRANCH_TREE],
      new Map([["feature", DELTA]]), new Map([["feature", [RUNNING]]]), new Map(), null,
    );
    expect(cards.map((c) => c.key)).toEqual(["n-dx", "feature"]);
    expect(cards[1].dirtyFiles).toBe(7);
    expect(cards[1].delta).toEqual(DELTA);
    expect(cards[1].live).toEqual(RUNNING);
  });

  it("gives the anchor no delta even when one was supplied", () => {
    // The anchor is what every delta is measured against; a delta on its own
    // card would be a diff against itself.
    const cards = buildWorkspaceCards([ANCHOR], [ANCHOR_TREE], new Map([["n-dx", DELTA]]), new Map(), new Map(), null);
    expect(cards[0].delta).toBeNull();
  });

  it("survives a worktree the git list does not know", () => {
    const cards = buildWorkspaceCards([BRANCH], [], new Map(), new Map(), new Map(), null);
    expect(cards[0].dirtyFiles).toBeNull();
    expect(cards[0].runs).toEqual({ total: 0, running: 0, lastFinishedAt: null });
    expect(cards[0].branch).toBe("feat/x"); // falls back to the registry's branch
  });

  it("marks the anchor current when the viewer has no workspace slot", () => {
    const cards = buildWorkspaceCards([ANCHOR, BRANCH], [], new Map(), new Map(), new Map(), null);
    expect(cards.find((c) => c.key === "n-dx")!.isCurrent).toBe(true);
    expect(cards.find((c) => c.key === "feature")!.isCurrent).toBe(false);
  });

  it("marks the addressed workspace current under a slot", () => {
    const cards = buildWorkspaceCards([ANCHOR, BRANCH], [], new Map(), new Map(), new Map(), "feature");
    expect(cards.find((c) => c.key === "feature")!.isCurrent).toBe(true);
    expect(cards.find((c) => c.key === "n-dx")!.isCurrent).toBe(false);
  });
});

describe("pickLiveExecution", () => {
  it("ignores finished executions", () => {
    expect(pickLiveExecution([{ ...RUNNING, status: "completed" }, { ...RUNNING, status: "failed" }])).toBeNull();
  });

  it("takes the newest of several live ones", () => {
    const older = { ...RUNNING, runId: "old", startedAt: "2026-09-16T11:00:00.000Z" };
    const newer = { ...RUNNING, runId: "new", startedAt: "2026-09-16T13:00:00.000Z" };
    expect(pickLiveExecution([older, newer])!.runId).toBe("new");
    expect(pickLiveExecution([newer, older])!.runId).toBe("new");
  });

  it("counts a starting execution as live", () => {
    expect(pickLiveExecution([{ ...RUNNING, status: "starting" }])).not.toBeNull();
  });
});

describe("machineStats", () => {
  const cards = buildWorkspaceCards(
    [ANCHOR, BRANCH], [ANCHOR_TREE, BRANCH_TREE],
    new Map([["feature", DELTA]]), new Map([["feature", [RUNNING]]]), new Map(), null,
  );

  it("sums the concurrency count when it is available", () => {
    const stats = machineStats(cards, new Map([["n-dx", 2], ["feature", 1]]), null);
    expect(stats.agentsRunning).toBe(3);
  });

  it("falls back to the disk run count for a workspace concurrency could not answer for", () => {
    // BRANCH_TREE has runs.running = 1; the anchor's concurrency said 2.
    const stats = machineStats(cards, new Map([["n-dx", 2]]), null);
    expect(stats.agentsRunning).toBe(3);
  });

  it("never reads lower than the live runs the cards are showing", () => {
    // Concurrency says nothing is running, but `feature` has a live execution
    // on screen — "0 agents running" beside a spinning card is the worse lie.
    const stats = machineStats(cards, new Map([["n-dx", 0], ["feature", 0]]), null);
    expect(stats.agentsRunning).toBe(1);
  });

  it("counts dirty trees, not dirty files", () => {
    expect(machineStats(cards, new Map(), null).uncommittedTrees).toBe(1);
  });

  it("sums onlyHere across branch worktrees only", () => {
    expect(machineStats(cards, new Map(), null).prdOnlyOnBranches).toBe(3);
  });

  it("passes the machine's memory through, or null when it could not be read", () => {
    const system = { totalBytes: 100, usedBytes: 40, usedPercent: 40 };
    expect(machineStats(cards, new Map(), { system }).memory).toEqual(system);
    expect(machineStats(cards, new Map(), null).memory).toBeNull();
  });
});

describe("frameWorkspace", () => {
  it("reads the tag", () => {
    expect(frameWorkspace({ type: "hench:run-changed", workspace: "feature" }, "n-dx")).toBe("feature");
  });

  it("treats an untagged frame as the anchor's — that is what an older server meant", () => {
    expect(frameWorkspace({ type: "hench:run-changed" }, "n-dx")).toBe("n-dx");
  });

  it("treats a `*` frame as belonging to no single workspace", () => {
    expect(frameWorkspace({ type: "hench:memory-status", workspace: "*" }, "n-dx")).toBeNull();
  });
});

describe("workspaceViewUrl", () => {
  it("has no slot for the anchor", () => {
    expect(workspaceViewUrl({ key: "n-dx", isAnchor: true }, "prd", "/prd")).toBe("/prd");
  });

  it("adds the slot for a branch worktree", () => {
    expect(workspaceViewUrl({ key: "feature", isAnchor: false }, "prd", "/prd")).toBe("/w/feature/prd");
  });

  it("keeps the hub's project prefix ahead of the slot", () => {
    expect(workspaceViewUrl({ key: "feature", isAnchor: false }, "prd", "/p/demo/workspaces"))
      .toBe("/p/demo/w/feature/prd");
  });

  it("escapes a key that needs it", () => {
    expect(workspaceViewUrl({ key: "a b", isAnchor: false }, "prd", "/")).toBe("/w/a%20b/prd");
  });
});

describe("small formatters", () => {
  it("formats bytes at GB and MB scale", () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("formats how long since the last run", () => {
    expect(formatSince(null)).toBeNull();
    expect(formatSince(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(formatSince(new Date(Date.now() + 60_000).toISOString())).toBeNull(); // clock skew
  });

  it("calls a workspace running when it has a live execution or a disk run", () => {
    const [anchor, branch] = buildWorkspaceCards(
      [ANCHOR, BRANCH], [ANCHOR_TREE, BRANCH_TREE], new Map(), new Map(), new Map(), null,
    );
    expect(cardStatus(anchor).label).toBe("Idle");
    expect(cardStatus(branch).label).toBe("Running"); // runs.running = 1, no dashboard execution
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A response stand-in.
 *
 * Deliberately not a real `Response`: undici's body is a stream, so `json()`
 * resolves a macrotask or two later and the tests would be racing the
 * transport rather than the component.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** A fetch stub that records the workspace header of every call. */
function makeFetcher(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; workspace: string | null; method: string }> = [];
  const bodies: Record<string, unknown> = {
    "/api/workspaces": { anchor: "n-dx", workspaces: [ANCHOR, BRANCH] },
    "/api/worktrees": [ANCHOR_TREE, BRANCH_TREE],
    "/api/hench/memory": { system: { totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 50 } },
    "/api/hench/execute/status": { executions: [] },
    "/api/hench/concurrency": { totalRunning: 0 },
    "/api/rex/next": { task: { id: "next-1", title: "Next up" } },
    "/api/workspaces/feature/prd-delta": { counts: DELTA },
    ...overrides,
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const workspace = headers.get("X-Ndx-Workspace");
    calls.push({ url, workspace, method: init?.method ?? "GET" });
    // Per-workspace bodies are keyed "<url>@<workspace>" when a test needs
    // two workspaces to answer differently.
    const body = bodies[`${url}@${workspace}`] ?? bodies[url];
    if (body === undefined) return jsonResponse({}, 404);
    return jsonResponse(body);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

/** A socket stub the test can push frames into. */
function makeSocket() {
  const socket = { onmessage: null as ((e: MessageEvent) => void) | null, close: vi.fn() };
  return {
    factory: () => socket as unknown as WebSocket,
    push(frame: unknown) {
      socket.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
    },
    socket,
  };
}

/**
 * Let effects run and their fetches resolve.
 *
 * Each iteration is its own `act` so a state update made by one round of
 * promises is committed before the next round observes it — one long `act`
 * would batch the whole cascade to the end.
 */
async function settle(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Mount inside `act` — a render outside it leaves effects on jsdom's rAF, which never fires here. */
async function mount(vnode: Parameters<typeof renderToDiv>[0]): Promise<HTMLDivElement> {
  let div!: HTMLDivElement;
  await act(async () => {
    div = renderToDiv(vnode);
  });
  await settle();
  return div;
}

describe("WorkspacesView", () => {
  let root: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = null;
    setBasePathForTests(null);
    vi.useRealTimers();
  });

  it("renders one card per worktree with branch, chips and actions", async () => {
    const { fetcher } = makeFetcher();
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const cards = root.querySelectorAll(".workspace-card");
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector(".workspace-card-name")!.textContent).toContain("n-dx");
    expect(cards[1].querySelector(".workspace-card-branch")!.textContent).toBe("feat/x");
    expect(cards[1].querySelector(".workspace-card-chip-dirty")!.textContent).toBe("7 uncommitted");
    expect(cards[0].querySelector(".workspace-card-chip-clean")!.textContent).toBe("clean");
    // The anchor has no delta chip; the branch reports both counts.
    expect(cards[0].querySelector(".workspace-card-chip-prd")).toBeNull();
    expect(cards[1].querySelector(".workspace-card-chip-prd")!.textContent)
      .toBe("PRD · 3 only here / 5 changed here");
  });

  it("names every per-workspace request's workspace", async () => {
    const { fetcher, calls } = makeFetcher();
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    // Without the header these three would answer for the viewer's own
    // workspace and both cards would show the anchor's numbers.
    for (const path of ["/api/hench/execute/status", "/api/hench/concurrency", "/api/rex/next"]) {
      const keys = calls.filter((c) => c.url === path).map((c) => c.workspace).sort();
      expect(keys).toEqual(["feature", "n-dx"]);
    }
    // The repo-wide three carry no workspace — they are not about one worktree.
    for (const path of ["/api/workspaces", "/api/worktrees", "/api/hench/memory"]) {
      expect(calls.find((c) => c.url === path)!.workspace).toBeNull();
    }
  });

  it("asks for a prd-delta for the branch worktree only", async () => {
    const { fetcher, calls } = makeFetcher();
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const deltas = calls.filter((c) => c.url.includes("prd-delta")).map((c) => c.url);
    expect(deltas).toEqual(["/api/workspaces/feature/prd-delta"]);
  });

  it("sums the machine strip across worktrees", async () => {
    const { fetcher } = makeFetcher({
      "/api/hench/concurrency@n-dx": { totalRunning: 1 },
      "/api/hench/concurrency@feature": { totalRunning: 2 },
    });
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const tiles = root.querySelectorAll(".workspaces-machine-strip .stat-card");
    expect(tiles.length).toBe(4);
    expect(tiles[0].querySelector(".value")!.textContent).toBe("3");       // 1 + 2 agents
    expect(tiles[1].querySelector(".value")!.textContent).toBe("50%");      // memory
    expect(tiles[2].querySelector(".value")!.textContent).toBe("1");        // one dirty tree
    expect(tiles[3].querySelector(".value")!.textContent).toBe("3");        // onlyHere
  });

  it("shows a live run and links its task into that worktree's PRD", async () => {
    const { fetcher } = makeFetcher({ "/api/hench/execute/status@feature": { executions: [RUNNING] } });
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const branch = root.querySelectorAll(".workspace-card")[1];
    const link = branch.querySelector<HTMLAnchorElement>(".workspace-card-run-link")!;
    expect(link.textContent).toBe("Wire the delta route");
    // Not "/prd/task-1": the task lives in the other worktree's tree.
    expect(link.getAttribute("href")).toBe("/w/feature/prd/task-1");
    expect(branch.querySelector(".workspace-card-output-text")!.textContent).toBe("running tests…");
    expect(branch.querySelector(".active-task-toks")!.textContent).toContain("42.5 tok/s");
    expect(branch.querySelector(".workspace-card-status")!.textContent).toBe("Running");
  });

  it("offers Stop while running and Start working while idle", async () => {
    const { fetcher } = makeFetcher({ "/api/hench/execute/status@feature": { executions: [RUNNING] } });
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const [anchor, branch] = root.querySelectorAll(".workspace-card");
    expect(branch.querySelector(".workspace-card-stop")).not.toBeNull();
    expect(branch.querySelector(".start-task-btn")).toBeNull();
    expect(anchor.querySelector(".workspace-card-stop")).toBeNull();
    expect(anchor.querySelector(".start-task-btn")!.textContent).toBe("Start working");
  });

  it("starts a run in the card's worktree, not the viewer's", async () => {
    const { fetcher, calls } = makeFetcher({ "/api/hench/execute": { runId: "exec-9", status: "started" } });
    // StartTaskButton is shared with other views and posts through the global
    // fetch, so the recorder has to be installed there to see the header.
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

      const branch = root.querySelectorAll(".workspace-card")[1];
      await act(async () => {
        branch.querySelector<HTMLButtonElement>(".start-task-btn")!.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      const start = calls.find((c) => c.url === "/api/hench/execute" && c.method === "POST");
      expect(start).toBeDefined();
      // The task is the one /api/rex/next named for *that* workspace.
      expect(start!.workspace).toBe("feature");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("stops the run in the card's worktree", async () => {
    const { fetcher, calls } = makeFetcher({
      "/api/hench/execute/status@feature": { executions: [RUNNING] },
      "/api/hench/execute/task-1/terminate": { terminated: true },
    });
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const branch = root.querySelectorAll(".workspace-card")[1];
    await act(async () => {
      branch.querySelector<HTMLButtonElement>(".workspace-card-stop")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    const stop = calls.find((c) => c.url.endsWith("/terminate"));
    expect(stop).toBeDefined();
    expect(stop!.method).toBe("POST");
    expect(stop!.workspace).toBe("feature");
  });

  it("updates a card when a run progresses in that other worktree", async () => {
    // The whole point of the board: this frame is about `feature`, and the
    // viewer is mounted on the anchor. Every other consumer drops it.
    let executions: ExecutionStatus[] = [];
    const { fetcher } = makeFetcher();
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (String(input) === "/api/hench/execute/status" && headers.get("X-Ndx-Workspace") === "feature") {
        return jsonResponse({ executions });
      }
      return fetcher(input, init);
    }) as typeof fetch;

    const socket = makeSocket();
    root = await mount(h(WorkspacesView, { fetcher: wrapped, socketFactory: socket.factory }));
    expect(root.querySelectorAll(".workspace-card")[1].querySelector(".workspace-card-run-link")).toBeNull();

    executions = [RUNNING];
    await act(async () => {
      socket.push({ type: "hench:task-execution-progress", workspace: "feature", state: RUNNING });
      await new Promise((r) => setTimeout(r, 500)); // past the burst debounce
    });
    await settle();

    expect(root.querySelectorAll(".workspace-card")[1].querySelector(".workspace-card-run-link")!.textContent)
      .toBe("Wire the delta route");
  });

  it("ignores frames that cannot move a card", async () => {
    const { fetcher, calls } = makeFetcher();
    const socket = makeSocket();
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: socket.factory }));
    const before = calls.length;

    await act(async () => {
      socket.push({ type: "sv:data-changed", workspace: "feature" });
      socket.push({ type: "ws:health-status", workspace: "*" });
      socket.push("not json");
      await new Promise((r) => setTimeout(r, 500));
    });

    expect(calls.length).toBe(before);
  });

  it("reports a server that does not know about workspaces", async () => {
    const { fetcher } = makeFetcher({ "/api/workspaces": undefined });
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: makeSocket().factory }));

    const message = root.querySelector('[role="alert"]');
    expect(message!.textContent).toContain("does not expose workspaces");
  });

  it("loads once when no fetcher is injected", async () => {
    // The registry renders `h(WorkspacesView, null)`. If the default fetcher
    // were built inline per render it would change `load`'s identity, and the
    // load effect would re-run on every render it had just caused — an
    // unbounded fetch loop that only shows up without the injected fetcher.
    const { fetcher, calls } = makeFetcher();
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      root = await mount(h(WorkspacesView, { socketFactory: makeSocket().factory }));
      await settle(10);
      expect(calls.filter((c) => c.url === "/api/workspaces").length).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("closes its socket on unmount", async () => {
    const { fetcher } = makeFetcher();
    const socket = makeSocket();
    root = await mount(h(WorkspacesView, { fetcher, socketFactory: socket.factory }));
    cleanupRenderedDiv(root);
    root = null;
    expect(socket.socket.close).toHaveBeenCalled();
  });
});
