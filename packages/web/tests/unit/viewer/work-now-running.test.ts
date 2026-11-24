// @vitest-environment jsdom
/**
 * Running now (Work › Now) lists runs from every worktree, so a row opens the
 * run where it runs: in place for this worktree, else under the owning
 * worktree's `/w/<key>/` slot — Live's own link (`PeekLink`, `runTarget`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RunningRow } from "../../../src/viewer/views/work-now.js";
import type { LiveRunFull } from "../../../src/viewer/hooks/use-live.js";

const root = document.createElement("div");
document.body.appendChild(root);

afterEach(() => { act(() => { render(null, root); }); });

function run(worktree: { key: string; isAnchor: boolean; name: string }): LiveRunFull {
  return {
    runId: "r1", taskId: "t1", taskTitle: "Fix the thing", branch: "feat/x",
    worktree: { ...worktree, path: `/repo/${worktree.name}`, branch: "feat/x", isServed: worktree.isAnchor },
    startedAt: new Date(Date.now() - 65_000).toISOString(), stale: false, lastProgress: null,
    epicChain: [], status: "running", finishedAt: null, turns: 3,
    tokens: { input: 1, output: 1, cacheCreationInput: 0, cacheReadInput: 0, total: 2 },
    model: "m", vendor: "claude", criteriaTotal: null, heartbeatAgeMs: 1_000, loop: null,
  } as unknown as LiveRunFull;
}

const title = () => root.querySelector<HTMLAnchorElement>("a.wn-run-title")!;

describe("Running now's run link", () => {
  it("opens a run in this worktree in place", () => {
    const navigateTo = vi.fn();
    act(() => { render(h(RunningRow, { run: run({ key: "main", isAnchor: true, name: "main" }), estimates: null, now: Date.now(), navigateTo }), root); });
    expect(title().getAttribute("href")).toBe("/live/task/t1");
    act(() => { title().click(); });
    expect(navigateTo).toHaveBeenCalledWith("live-task", { taskId: "t1" });
  });

  it("links another worktree's run to that worktree's slot, and leaves the click to the browser", () => {
    const navigateTo = vi.fn();
    act(() => { render(h(RunningRow, { run: run({ key: "feature", isAnchor: false, name: "feature" }), estimates: null, now: Date.now(), navigateTo }), root); });
    expect(title().getAttribute("href")).toBe("/w/feature/live/task/t1");
    let intercepted = true;
    title().addEventListener("click", (e) => { intercepted = e.defaultPrevented; e.preventDefault(); });
    act(() => { title().click(); });
    expect(intercepted).toBe(false);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
