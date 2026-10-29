// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import { latestRunVerdict, runVerdictClassLabel, RUN_VERDICT_CLASS_LABELS, type VerdictRun } from "../../../src/viewer/components/prd-tree/run-verdict-banner.js";
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
    expect(text).toContain("Out of budget or time");
    expect(text).not.toContain("budget-timeout");
    expect(banner!.getAttribute("data-verdict-class")).toBe("budget-timeout");
    expect(banner!.querySelector(".task-run-verdict-class")!.getAttribute("title")).toBe("budget-timeout");
    expect(text).toContain("The run timed out before finishing.");
    expect(text).toContain("Next: Split the task into smaller ones");
    expect(text).not.toContain("raise the task's model tier");
    expect(text).toContain("attempt 2 of 2");
  });

  it("leads the panel: below the title and status, above the description and the runs list", async () => {
    const root = await renderWith([runSummary({ diagnosis: DIAGNOSIS })], true);
    const order = [".task-title-display", ".task-status-selector", ".task-run-verdict", ".task-add-description-btn", ".task-runs-section"]
      .map((sel) => {
        const el = root.querySelector(sel);
        expect(el, sel).not.toBeNull();
        return el!;
      });
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(root.querySelector(".task-runs-section .task-run-verdict")).toBeNull();
  });

  it("labels each of hench's nine classes readably, keeping the raw id as title and data attribute", async () => {
    const classes = [
      "test-gate-new", "test-gate-preexisting", "completion-held", "review-blocked", "claim-lost",
      "budget-timeout", "vendor-transient", "no-changes", "unclassified",
    ];
    const labels = new Set<string>();
    for (const cls of classes) {
      const root = await renderWith([runSummary({ diagnosis: { ...DIAGNOSIS, class: cls } })], true);
      const label = root.querySelector(".task-run-verdict-class")!;
      expect(label.getAttribute("title")).toBe(cls);
      expect(label.closest(".task-run-verdict")!.getAttribute("data-verdict-class")).toBe(cls);
      expect(label.textContent).toBe(RUN_VERDICT_CLASS_LABELS[cls]);
      expect(label.textContent).not.toBe(cls);
      labels.add(label.textContent!);
    }
    expect(labels.size).toBe(classes.length);
    expect(RUN_VERDICT_CLASS_LABELS["test-gate-preexisting"]).toBe("Pre-existing test failure");
  });

  it("shows an unknown class as its id", () => {
    expect(runVerdictClassLabel("some-new-class")).toBe("some-new-class");
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
