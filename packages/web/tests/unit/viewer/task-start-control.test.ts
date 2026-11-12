// @vitest-environment jsdom
/**
 * Who is offered a start button, on every surface that has one.
 *
 * `startOffer` is the single rule; `TaskStartControl` renders it. The PRD task
 * panel used to carry its own copy with a different rule (blocked tasks got a
 * button, in-progress ones none), so both layers are pinned here.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "preact";
import { act } from "preact/test-utils";
import { defaultsRunBlockOf, startOffer } from "../../../src/viewer/components/prepare-task-model.js";
import { TaskStartControl } from "../../../src/viewer/components/task-start-control.js";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";
import { prepFixture } from "../../helpers/prep-fixture.js";
import { savedPrep, stubStartFetch } from "../../helpers/start-task-fetch.js";

describe("startOffer", () => {
  it("starts pending and deferred tasks", () => {
    expect(startOffer({ status: "pending" }, false)).toEqual({ kind: "start", resume: false });
    expect(startOffer({ status: "deferred" }, false)).toEqual({ kind: "start", resume: false });
  });

  it("resumes an in-progress task with no live run", () => {
    expect(startOffer({ status: "in_progress" }, false)).toEqual({ kind: "start", resume: true });
  });

  it("links to Live while a run is live, whatever the status", () => {
    expect(startOffer({ status: "in_progress" }, true)).toEqual({ kind: "live" });
    expect(startOffer({ status: "pending" }, true)).toEqual({ kind: "live" });
  });

  it("names the blockers of a blocked task instead of offering a start", () => {
    const offer = startOffer({ status: "blocked", blockedBy: ["a", "b"] }, false, (id) => (id === "a" ? "Task A" : null));
    expect(offer).toEqual({ kind: "blocked", blockers: [{ id: "a", title: "Task A" }, { id: "b", title: null }] });
  });

  it("offers nothing for finished work", () => {
    for (const status of ["completed", "failing", "deleted"]) {
      expect(startOffer({ status }, false)).toEqual({ kind: "none" });
    }
  });
});

describe("TaskStartControl", () => {
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    vi.restoreAllMocks();
  });

  function stubLive(runs: Array<{ taskId: string; liveness?: string }>): void {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ runs, jobs: [], counts: { running: runs.length, stale: 0, jobs: 0 } }),
    })));
  }

  async function mount(task: { id: string; status: string; blockedBy?: string[] }): Promise<HTMLDivElement> {
    root = renderToDiv(h(TaskStartControl, { task, onStarted: () => {}, titleOf: () => "Upstream work" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return root;
  }

  it("shows Resume for an in-progress task with no live run", async () => {
    stubLive([]);
    const el = await mount({ id: "t", status: "in_progress" });
    expect(el.querySelector(".start-task-primary")!.textContent).toBe("Resume");
  });

  it("shows a link to the Live task page, and no Start or Stop, while a run is live", async () => {
    stubLive([{ taskId: "t", liveness: "live" }]);
    const el = await mount({ id: "t", status: "in_progress" });
    expect(el.querySelector(".start-task-primary")).toBeNull();
    expect(el.querySelector<HTMLAnchorElement>(".task-live-link")!.getAttribute("href")).toContain("/live/task/t");
    expect(el.textContent).not.toContain("Stop");
  });

  it("ignores a dead run record", async () => {
    stubLive([{ taskId: "t", liveness: "orphaned" }]);
    const el = await mount({ id: "t", status: "in_progress" });
    expect(el.querySelector(".start-task-primary")!.textContent).toBe("Resume");
  });

  it("shows blockers, not a button, for a blocked task", async () => {
    stubLive([]);
    const el = await mount({ id: "t", status: "blocked", blockedBy: ["u"] });
    expect(el.querySelector(".start-task-primary")).toBeNull();
    expect(el.querySelector(".task-blockers")!.textContent).toContain("Upstream work");
  });
});

describe("TaskDetail start control", () => {
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    if (root) cleanupRenderedDiv(root);
    root = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the split button for a pending task and no legacy Execute button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ runs: [], jobs: [], counts: { running: 0, stale: 0, jobs: 0 } }),
    })));
    const item = { id: "t", title: "T", status: "pending", level: "task" } as const;
    root = renderToDiv(h(TaskDetail, { item: { ...item }, allItems: [{ ...item }] }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root.querySelector(".start-task-primary")).not.toBeNull();
    expect(root.querySelector(".task-execute-btn")).toBeNull();
  });

  /** Give the detail panel its Live snapshot and Start its real prep shape. */
  function stubServer(prep = prepFixture()) {
    const stub = stubStartFetch({ prep });
    const startFetch = stub.fetch.getMockImplementation()!;
    stub.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live") return {
        ok: true,
        status: 200,
        json: async () => ({ runs: [], jobs: [], counts: { running: 0, stale: 0, jobs: 0 } }),
      };
      if (url === "/api/rex/changes") return {
        ok: true, status: 200, json: async () => ({ changes: [] }),
      };
      if (!url.startsWith("/api/hench/")) return {
        ok: false, status: 404, json: async () => ({ error: "Not available in this fixture" }),
      };
      return startFetch(url, init);
    });
    return stub;
  }

  it.each([false, true])("starts a change the server flags as running as one task in one click (saved settings: %s)", async (saved) => {
    vi.useFakeTimers();
    const item = { id: "solo", title: "Solo", status: "pending", type: "change", runsAsOneTask: true } as const;
    const task = { id: item.id, title: item.title, status: item.status, itemType: item.type };
    const prep = saved ? savedPrep({ task }) : prepFixture({ task });
    const stub = stubServer(prep);
    await act(async () => {
      root = renderToDiv(h(TaskDetail, { item: { ...item }, allItems: [{ ...item }] }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(root!.querySelector(".start-task-primary")!.textContent).toBe("Start");
    await act(async () => {
      root!.querySelector<HTMLButtonElement>(".start-task-primary")!.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(stub.saves()).toHaveLength(0);
    expect(stub.calls.filter((c) => c.url.startsWith("/api/hench/prep/")).map((c) => `${c.method} ${c.url}`))
      .toEqual(["GET /api/hench/prep/solo"]);
    expect(stub.executes().map((c) => c.body)).toEqual([saved
      ? { taskId: "solo" }
      : { taskId: "solo", saveRun: { run: defaultsRunBlockOf(prep), version: "none" } }]);
  });

  it("opens a task-less change's settings directly from the arrow without starting or saving", async () => {
    vi.useFakeTimers();
    const item = { id: "solo", title: "Solo", status: "pending", type: "change", runsAsOneTask: true } as const;
    const stub = stubServer(prepFixture({
      task: { id: item.id, title: item.title, status: item.status, itemType: item.type },
    }));
    await act(async () => {
      root = renderToDiv(h(TaskDetail, { item: { ...item }, allItems: [{ ...item }] }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      root!.querySelector<HTMLButtonElement>(".start-task-caret")!.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    // Opening mounts the modal; flush the prep read its mount effect starts.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector(".prep-task-title")!.textContent).toBe("Solo");
    expect(dialog!.querySelector(".prep-loading")).toBeNull();
    expect(stub.calls.filter((c) => c.url.startsWith("/api/hench/prep/")).map((c) => `${c.method} ${c.url}`))
      .toEqual(["GET /api/hench/prep/solo"]);
    expect(stub.executes()).toHaveLength(0);
    expect(stub.saves()).toHaveLength(0);
  });

  it("offers no start for a change with tasks", async () => {
    stubServer();
    const item: PRDItemData = {
      id: "with-tasks", title: "With tasks", status: "pending", type: "change",
      children: [{ id: "t1", title: "T1", status: "pending", type: "task" }],
    };
    root = renderToDiv(h(TaskDetail, { item, allItems: [item] }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root.querySelector(".task-execute-section")).toBeNull();
    expect(root.querySelector(".start-task-primary")).toBeNull();
  });
});
