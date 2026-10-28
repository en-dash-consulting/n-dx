// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { latestRunVerdict, type VerdictRun } from "../../../src/viewer/components/prd-tree/run-verdict-banner.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

/**
 * The task page's verdict banner: shown for the latest run's diagnosis with
 * `hench.runVerdict` on, absent with it off or when that run completed.
 */

const DIAGNOSIS = {
  class: "budget-timeout",
  summary: "The run timed out before finishing.",
  evidence: ["status: timeout"],
  actions: [
    { kind: "split-task", label: "Split the task into smaller ones" },
    { kind: "raise-tier", label: "Or raise the task's model tier" },
  ],
  attempt: { n: 2, of: 2 },
};

function runSummary(over: Record<string, unknown>) {
  return {
    id: "r1", status: "timeout", startedAt: "2026-10-28T10:00:00.000Z", finishedAt: "2026-10-28T10:10:00.000Z",
    turns: 3, tokenUsage: { input: 1, output: 1 }, ...over,
  };
}

const item: PRDItemData = { id: "task-1", title: "A task", status: "pending", level: "task" };

async function renderWith(runs: unknown[], verdictToggle: boolean): Promise<HTMLElement> {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.startsWith("/api/features")
      ? { toggles: [{ key: "hench.runVerdict", enabled: verdictToggle }] }
      : url.startsWith("/api/hench/runs")
        ? { runs, total: runs.length }
        : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  const root = document.createElement("div");
  await act(async () => { render(h(TaskDetail, { item, allItems: [item], onUpdate: vi.fn() }), root); });
  for (let i = 0; i < 3; i++) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run verdict banner", () => {
  it("shows class, summary, first action and attempt when on and the latest run has a diagnosis", async () => {
    const root = await renderWith([runSummary({ diagnosis: DIAGNOSIS })], true);
    const banner = root.querySelector(".task-run-verdict");
    expect(banner).not.toBeNull();
    const text = banner!.textContent ?? "";
    expect(text).toContain("budget-timeout");
    expect(text).toContain("The run timed out before finishing.");
    expect(text).toContain("Next: Split the task into smaller ones");
    expect(text).not.toContain("raise the task's model tier");
    expect(text).toContain("attempt 2 of 2");
  });

  it("shows nothing when the toggle is off", async () => {
    const root = await renderWith([runSummary({ diagnosis: DIAGNOSIS })], false);
    expect(root.querySelector(".task-runs-section")).not.toBeNull();
    expect(root.querySelector(".task-run-verdict")).toBeNull();
  });

  it("shows nothing when the latest run completed, even if an earlier one has a diagnosis", async () => {
    const root = await renderWith([
      runSummary({ id: "r2", status: "completed", startedAt: "2026-10-28T11:00:00.000Z" }),
      runSummary({ diagnosis: DIAGNOSIS }),
    ], true);
    expect(root.querySelector(".task-runs-section")).not.toBeNull();
    expect(root.querySelector(".task-run-verdict")).toBeNull();
  });
});

describe("latestRunVerdict", () => {
  const failed = (startedAt: string, diagnosis?: typeof DIAGNOSIS): VerdictRun => ({ status: "failed", startedAt, diagnosis });

  it("picks the latest run regardless of order", () => {
    expect(latestRunVerdict([failed("2026-01-01"), failed("2026-02-01", DIAGNOSIS)])).toEqual(DIAGNOSIS);
    expect(latestRunVerdict([failed("2026-02-01"), failed("2026-01-01", DIAGNOSIS)])).toBeNull();
  });

  it("is null for no runs and for a running latest run", () => {
    expect(latestRunVerdict([])).toBeNull();
    expect(latestRunVerdict([{ status: "running", startedAt: "2026-03-01", diagnosis: DIAGNOSIS }])).toBeNull();
  });
});
