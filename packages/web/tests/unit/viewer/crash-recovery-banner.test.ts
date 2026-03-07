// @vitest-environment jsdom
/**
 * Tests for the CrashRecoveryBanner component.
 *
 * Covers: rendering states, crash loop vs single crash messaging,
 * restore and dismiss buttons, accessibility attributes, and
 * null state handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { CrashRecoveryBanner } from "../../../src/viewer/components/crash-recovery-banner.js";
import type { SavedNavigationState } from "../../../src/viewer/performance/crash-detector.js";

function makeState(overrides: Partial<SavedNavigationState> = {}): SavedNavigationState {
  return {
    view: "graph",
    selectedFile: null,
    selectedZone: null,
    selectedRunId: null,
    selectedTaskId: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("CrashRecoveryBanner", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing when visible is false", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: false,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    expect(root.children.length).toBe(0);
  });

  it("renders recovery banner for a single crash", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".crash-recovery-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("crash-recovery-loop")).toBe(false);
    expect(root.textContent).toContain("Recovered from a crash");
  });

  it("renders crash loop banner for multiple recent crashes", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: true,
        recentCrashCount: 3,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".crash-recovery-banner");
    expect(banner).not.toBeNull();
    expect(banner!.classList.contains("crash-recovery-loop")).toBe(true);
    expect(root.textContent).toContain("Repeated crashes detected");
    expect(root.textContent).toContain("3 times recently");
  });

  it("shows 'Restore view' button when state is available and not in crash loop", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState({ view: "prd" }),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const restoreBtn = root.querySelector(".crash-recovery-restore");
    expect(restoreBtn).not.toBeNull();
    expect(restoreBtn!.textContent).toBe("Restore view");
  });

  it("does not show 'Restore view' button during crash loop", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: true,
        recentCrashCount: 3,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const restoreBtn = root.querySelector(".crash-recovery-restore");
    expect(restoreBtn).toBeNull();
  });

  it("does not show 'Restore view' button when no state to restore", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: null,
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const restoreBtn = root.querySelector(".crash-recovery-restore");
    expect(restoreBtn).toBeNull();
  });

  it("shows saved view name in state info", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState({ view: "hench-runs" }),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    expect(root.textContent).toContain("Hench Runs");
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: null,
        onDismiss,
        onRestore: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-dismiss");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onRestore when restore button is clicked", () => {
    const onRestore = vi.fn();
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore,
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-restore");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("has role=alert for accessibility", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: null,
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const banner = root.querySelector(".crash-recovery-banner");
    expect(banner!.getAttribute("role")).toBe("alert");
    expect(banner!.getAttribute("aria-live")).toBe("assertive");
  });

  it("dismiss button has accessible label", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: null,
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-dismiss");
    expect(btn!.getAttribute("aria-label")).toBe("Dismiss crash recovery message");
  });

  it("dismiss button says 'Start fresh' when state is available", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-dismiss");
    expect(btn!.textContent).toBe("Start fresh");
  });

  it("dismiss button says 'Dismiss' when no state available", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: false,
        recentCrashCount: 1,
        recoveredState: null,
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-dismiss");
    expect(btn!.textContent).toBe("Dismiss");
  });

  it("dismiss button says 'Dismiss' during crash loop", () => {
    render(
      h(CrashRecoveryBanner, {
        visible: true,
        crashLoop: true,
        recentCrashCount: 3,
        recoveredState: makeState(),
        onDismiss: vi.fn(),
        onRestore: vi.fn(),
      }),
      root,
    );
    const btn = root.querySelector<HTMLButtonElement>(".crash-recovery-dismiss");
    expect(btn!.textContent).toBe("Dismiss");
  });
});
