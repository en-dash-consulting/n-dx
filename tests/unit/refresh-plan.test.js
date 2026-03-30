import { describe, it, expect } from "vitest";
import { buildRefreshPlan, RefreshPlanError } from "../../packages/core/refresh-plan.js";

describe("buildRefreshPlan", () => {
  it("builds a UI-only plan that skips data refresh steps", () => {
    const plan = buildRefreshPlan(["--ui-only"]);
    expect(plan.steps).toEqual([{ kind: "web-build" }]);
    expect(plan.steps.some((s) => s.kind === "sourcevision-analyze")).toBe(false);
    expect(plan.skippedSteps).toEqual([
      { kind: "sourcevision-analyze", reason: "--ui-only" },
      { kind: "sourcevision-dashboard-artifacts", reason: "--ui-only" },
    ]);
  });

  it("builds a data-only plan and reports UI build skip decision", () => {
    const plan = buildRefreshPlan(["--data-only"]);
    expect(plan.steps).toEqual([
      { kind: "sourcevision-analyze" },
      { kind: "sourcevision-dashboard-artifacts" },
    ]);
    expect(plan.notes.some((n) => n.includes("skipping UI build because --data-only was set"))).toBe(true);
  });

  it("builds a pr-markdown-only plan with required sourcevision prerequisite", () => {
    const plan = buildRefreshPlan(["--pr-markdown"]);
    expect(plan.steps).toEqual([{ kind: "sourcevision-pr-markdown" }]);
    expect(plan.needsSourcevisionDir).toBe(true);
    expect(plan.notes.some((n) => n.includes("PR markdown refresh only"))).toBe(true);
  });

  it("includes dashboard artifact refresh in the default plan", () => {
    const plan = buildRefreshPlan([]);
    expect(plan.steps).toEqual([
      { kind: "sourcevision-analyze" },
      { kind: "sourcevision-dashboard-artifacts" },
      { kind: "web-build" },
    ]);
  });

  it("marks build as skipped when --no-build is set", () => {
    const plan = buildRefreshPlan(["--no-build"]);
    expect(plan.steps).toEqual([
      { kind: "sourcevision-analyze" },
      { kind: "sourcevision-dashboard-artifacts" },
    ]);
    expect(plan.skippedSteps).toEqual([{ kind: "web-build", reason: "--no-build" }]);
  });

  it("treats --ui-only --no-build as a valid no-op build plan", () => {
    const plan = buildRefreshPlan(["--ui-only", "--no-build"]);
    expect(plan.steps).toEqual([]);
    expect(plan.skippedSteps).toEqual([
      { kind: "sourcevision-analyze", reason: "--ui-only" },
      { kind: "sourcevision-dashboard-artifacts", reason: "--ui-only" },
      { kind: "web-build", reason: "--no-build" },
    ]);
  });

  it("rejects --ui-only and --data-only together with actionable guidance", () => {
    try {
      buildRefreshPlan(["--ui-only", "--data-only"]);
      throw new Error("Expected buildRefreshPlan to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RefreshPlanError);
      expect(err.message).toContain("--ui-only and --data-only cannot be used together");
      expect(err.suggestion).toContain("Choose one scope flag");
    }
  });
});
