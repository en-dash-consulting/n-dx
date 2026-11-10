// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  DiagnoseInSidecarButton,
  DiagnoseInSidecarContext,
  RunVerdictChip,
  isFailedRun,
  newestRunIds,
} from "../../../src/viewer/components/diagnose-in-sidecar.js";
import { pageItemFor, resolveLens, wantedLensFor } from "../../../src/viewer/hooks/use-sidecar-attachment.js";

const VERDICT = {
  class: "test-gate-new",
  summary: "The run's own tests fail",
  evidence: [],
  actions: [],
  attempt: { n: 1, of: 2 },
};

describe("Run verdict chip", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); });

  it("names the classifier's verdict with its summary as the title", () => {
    render(h(RunVerdictChip, { diagnosis: VERDICT }), root);
    const chip = root.querySelector<HTMLElement>(".hench-run-verdict-chip");
    expect(chip?.textContent).toBe("New test failure");
    expect(chip?.title).toBe(VERDICT.summary);
    expect(chip?.dataset.verdictClass).toBe("test-gate-new");
  });

  it("draws nothing for a run with no verdict", () => {
    render(h(RunVerdictChip, {}), root);
    expect(root.innerHTML).toBe("");
  });
});

describe("failed and newest runs", () => {
  it("counts every run that ended without completing as failed", () => {
    // hench's RunStatus failures, each of which the classifier gives a verdict.
    expect(["failed", "timeout", "budget_exceeded", "error_transient", "error"].every(isFailedRun)).toBe(true);
    expect(["completed", "running", "in_progress", "cancelled"].some(isFailedRun)).toBe(false);
  });

  it("picks each task's newest run", () => {
    const ids = newestRunIds([
      { id: "a1", taskId: "A", startedAt: "2026-11-05T01:00:00Z" },
      { id: "a2", taskId: "A", startedAt: "2026-11-05T02:00:00Z" },
      { id: "b1", taskId: "B", startedAt: "2026-11-05T00:00:00Z" },
    ]);
    expect([...ids].sort()).toEqual(["a2", "b1"]);
  });
});

describe("Diagnose in Sidecar", () => {
  let root: HTMLDivElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { render(null, root); root.remove(); });

  it("draws nothing while the Sidecar is off", () => {
    render(h(DiagnoseInSidecarButton, { taskId: "T1" }), root);
    expect(root.innerHTML).toBe("");
  });

  it("attaches the task without selecting the run underneath", () => {
    const diagnose = vi.fn();
    const select = vi.fn();
    render(
      h(DiagnoseInSidecarContext.Provider, { value: { diagnose, attached: null } },
        h("div", { onClick: select }, h(DiagnoseInSidecarButton, { taskId: "T1" }))),
      root,
    );
    act(() => { root.querySelector<HTMLButtonElement>("button")?.click(); });
    expect(diagnose).toHaveBeenCalledWith("T1");
    expect(select).not.toHaveBeenCalled();
  });

  it("marks the task attached for diagnosis", () => {
    render(
      h(DiagnoseInSidecarContext.Provider, { value: { diagnose: vi.fn(), attached: "T1" } },
        h(DiagnoseInSidecarButton, { taskId: "T1" })),
      root,
    );
    expect(root.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("asks with the Diagnose run lens on any page, whether or not the last run failed", () => {
    const item = pageItemFor({ view: "hench-runs", zone: null, taskId: null, diagnoseTaskId: "T1" });
    expect(item).toMatchObject({ kind: "task", ref: "T1" });
    expect(wantedLensFor(item, false)).toBe("diagnose-run");
    const registry = [{ id: "diagnose-run", available: true, target: { kind: "task", needs: "a task to diagnose" } }];
    expect(resolveLens("diagnose-run", registry, item).running).toBe("diagnose-run");
  });
});
