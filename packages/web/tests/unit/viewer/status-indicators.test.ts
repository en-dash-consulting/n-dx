// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import {
  SvFreshnessIndicator,
  RexCompletionIndicator,
  HenchActivityIndicator,
} from "../../../src/viewer/components/status-indicators.js";

describe("SvFreshnessIndicator", () => {
  let root: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    onNavigate.mockClear();
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("shows 'No analysis' when freshness is unavailable", () => {
    render(
      h(SvFreshnessIndicator, {
        status: {
          freshness: "unavailable",
          analyzedAt: null,
          minutesAgo: null,
          modulesComplete: 0,
          modulesTotal: 5,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("No analysis");
    expect(root.querySelector(".indicator-dot-unavailable")).not.toBeNull();
  });

  it("shows 'Fresh' when analysis is recent", () => {
    render(
      h(SvFreshnessIndicator, {
        status: {
          freshness: "fresh",
          analyzedAt: new Date().toISOString(),
          minutesAgo: 5,
          modulesComplete: 5,
          modulesTotal: 5,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("Fresh");
    expect(root.querySelector(".indicator-dot-fresh")).not.toBeNull();
  });

  it("shows 'Stale' when analysis is old", () => {
    render(
      h(SvFreshnessIndicator, {
        status: {
          freshness: "stale",
          analyzedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          minutesAgo: 48 * 60,
          modulesComplete: 5,
          modulesTotal: 5,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("Stale");
    expect(root.querySelector(".indicator-dot-stale")).not.toBeNull();
  });

  it("navigates to overview on click", () => {
    render(
      h(SvFreshnessIndicator, {
        status: {
          freshness: "fresh",
          analyzedAt: new Date().toISOString(),
          minutesAgo: 5,
          modulesComplete: 5,
          modulesTotal: 5,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const indicator = root.querySelector<HTMLElement>(".sidebar-indicator");
    indicator?.click();
    expect(onNavigate).toHaveBeenCalledWith("overview");
  });

  it("has appropriate aria-label for fresh status", () => {
    render(
      h(SvFreshnessIndicator, {
        status: {
          freshness: "fresh",
          analyzedAt: new Date().toISOString(),
          minutesAgo: 30,
          modulesComplete: 5,
          modulesTotal: 5,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const indicator = root.querySelector(".sidebar-indicator");
    expect(indicator?.getAttribute("aria-label")).toContain("fresh");
    expect(indicator?.getAttribute("aria-label")).toContain("click to view");
  });
});

describe("RexCompletionIndicator", () => {
  let root: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    onNavigate.mockClear();
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("shows 'No PRD' when PRD does not exist", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: false,
          percentComplete: 0,
          stats: null,
          hasInProgress: false,
          hasPending: false,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("No PRD");
    expect(root.querySelector(".indicator-dot-unavailable")).not.toBeNull();
  });

  it("shows completion percentage when PRD exists", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 42,
          stats: { total: 10, completed: 4, inProgress: 2, pending: 3, deferred: 0, blocked: 1 },
          hasInProgress: true,
          hasPending: true,
          nextTaskTitle: "Fix the thing",
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("42%");
    expect(root.textContent).toContain("4/10");
  });

  it("shows progress bar with correct width", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 60,
          stats: { total: 5, completed: 3, inProgress: 1, pending: 1, deferred: 0, blocked: 0 },
          hasInProgress: true,
          hasPending: true,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const fill = root.querySelector<HTMLElement>(".indicator-fill");
    expect(fill?.style.width).toBe("60%");
  });

  it("shows active badge when tasks are in progress", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 50,
          stats: { total: 4, completed: 2, inProgress: 1, pending: 1, deferred: 0, blocked: 0 },
          hasInProgress: true,
          hasPending: true,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.querySelector(".indicator-badge-active")).not.toBeNull();
    expect(root.querySelector(".indicator-badge-pending")).not.toBeNull();
  });

  it("shows next task title when available", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 25,
          stats: { total: 4, completed: 1, inProgress: 0, pending: 3, deferred: 0, blocked: 0 },
          hasInProgress: false,
          hasPending: true,
          nextTaskTitle: "Implement dark mode",
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("Next:");
    expect(root.textContent).toContain("Implement dark mode");
  });

  it("navigates to rex-dashboard on click", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 50,
          stats: { total: 2, completed: 1, inProgress: 0, pending: 1, deferred: 0, blocked: 0 },
          hasInProgress: false,
          hasPending: true,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const indicator = root.querySelector<HTMLElement>(".sidebar-indicator-prd");
    indicator?.click();
    expect(onNavigate).toHaveBeenCalledWith("rex-dashboard");
  });

  it("uses active fill color when tasks are in progress", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 50,
          stats: { total: 2, completed: 1, inProgress: 1, pending: 0, deferred: 0, blocked: 0 },
          hasInProgress: true,
          hasPending: false,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.querySelector(".indicator-fill-active")).not.toBeNull();
  });

  it("uses default fill color when no tasks are in progress", () => {
    render(
      h(RexCompletionIndicator, {
        status: {
          exists: true,
          percentComplete: 50,
          stats: { total: 2, completed: 1, inProgress: 0, pending: 1, deferred: 0, blocked: 0 },
          hasInProgress: false,
          hasPending: true,
          nextTaskTitle: null,
        },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.querySelector(".indicator-fill-default")).not.toBeNull();
  });
});

describe("HenchActivityIndicator", () => {
  let root: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    onNavigate.mockClear();
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("shows 'Not configured' when hench is not configured", () => {
    render(
      h(HenchActivityIndicator, {
        status: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("Not configured");
    expect(root.querySelector(".indicator-dot-unavailable")).not.toBeNull();
  });

  it("shows run count when configured", () => {
    render(
      h(HenchActivityIndicator, {
        status: { configured: true, totalRuns: 5, activeRuns: 0, staleRuns: 0 },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("5 runs");
    expect(root.querySelector(".indicator-dot-fresh")).not.toBeNull();
  });

  it("uses singular 'run' for 1 run", () => {
    render(
      h(HenchActivityIndicator, {
        status: { configured: true, totalRuns: 1, activeRuns: 0, staleRuns: 0 },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    expect(root.textContent).toContain("1 run");
    expect(root.textContent).not.toContain("1 runs");
  });

  it("navigates to hench-runs on click", () => {
    render(
      h(HenchActivityIndicator, {
        status: { configured: true, totalRuns: 3, activeRuns: 0, staleRuns: 0 },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const indicator = root.querySelector<HTMLElement>(".sidebar-indicator");
    indicator?.click();
    expect(onNavigate).toHaveBeenCalledWith("hench-runs");
  });

  it("has appropriate aria-label", () => {
    render(
      h(HenchActivityIndicator, {
        status: { configured: true, totalRuns: 3, activeRuns: 0, staleRuns: 0 },
        onNavigate,
        tabIndex: 0,
      }),
      root,
    );
    const indicator = root.querySelector(".sidebar-indicator");
    expect(indicator?.getAttribute("aria-label")).toContain("3 runs");
    expect(indicator?.getAttribute("aria-label")).toContain("click to view");
  });
});
