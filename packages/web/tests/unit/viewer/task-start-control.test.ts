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
import { startOffer } from "../../../src/viewer/components/prepare-task-model.js";
import { TaskStartControl } from "../../../src/viewer/components/task-start-control.js";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { renderToDiv, cleanupRenderedDiv } from "../../helpers/preact-test-support.js";

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
});
