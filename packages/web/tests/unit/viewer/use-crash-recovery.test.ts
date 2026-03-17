// @vitest-environment jsdom
/**
 * Tests for the useCrashRecovery Preact hook.
 *
 * Covers: initial crash detection, navigation state saving on view changes,
 * dismiss and restore actions, disabled mode, crash loop detection, and
 * recovery-already-shown deduplication.
 *
 * The crash-detector module is mocked so these tests isolate hook logic
 * from the sessionStorage-based detection tested in crash-detector.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  useCrashRecovery,
  type UseCrashRecoveryResult,
} from "../../../src/viewer/hooks/use-crash-recovery.js";
import type { CrashDetectionResult, SavedNavigationState } from "../../../src/viewer/crash/crash-detector.js";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockDetectCrash = vi.fn<() => CrashDetectionResult>();
const mockSaveNavigationState = vi.fn();
const mockClearSavedNavigationState = vi.fn();
const mockMarkRecoveryShown = vi.fn();
const mockWasRecoveryShown = vi.fn<() => boolean>();
const mockResetCrashDetector = vi.fn();

vi.mock("../../../src/viewer/crash/index.js", () => ({
  detectCrash: (...args: unknown[]) => mockDetectCrash(...(args as [])),
  saveNavigationState: (...args: unknown[]) => mockSaveNavigationState(...args),
  clearSavedNavigationState: (...args: unknown[]) => mockClearSavedNavigationState(...args),
  markRecoveryShown: (...args: unknown[]) => mockMarkRecoveryShown(...args),
  wasRecoveryShown: (...args: unknown[]) => mockWasRecoveryShown(...(args as [])),
  resetCrashDetector: (...args: unknown[]) => mockResetCrashDetector(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function noCrash(overrides: Partial<CrashDetectionResult> = {}): CrashDetectionResult {
  return { crashed: false, crashLoop: false, recentCrashCount: 0, recoveredState: null, ...overrides };
}

function crashed(overrides: Partial<CrashDetectionResult> = {}): CrashDetectionResult {
  return { crashed: true, crashLoop: false, recentCrashCount: 1, recoveredState: null, ...overrides };
}

function makeNavState(overrides: Partial<SavedNavigationState> = {}): SavedNavigationState {
  return {
    view: "graph", selectedFile: null, selectedZone: null,
    selectedRunId: null, selectedTaskId: null,
    timestamp: new Date().toISOString(), ...overrides,
  };
}

let hookResult: UseCrashRecoveryResult;

function TestHarness(props: {
  view?: string;
  enabled?: boolean;
  selectedFile?: string | null;
  selectedZone?: string | null;
  selectedRunId?: string | null;
  selectedTaskId?: string | null;
}) {
  hookResult = useCrashRecovery({
    view: (props.view ?? "overview") as any,
    selectedFile: props.selectedFile ?? null,
    selectedZone: props.selectedZone ?? null,
    selectedRunId: props.selectedRunId ?? null,
    selectedTaskId: props.selectedTaskId ?? null,
    enabled: props.enabled,
  });
  return h("div", null);
}

/**
 * Render the harness inside act() with fake timers advanced to
 * flush Preact's deferred useEffect callbacks and any resulting
 * setState re-renders.
 */
function renderAndFlush(root: HTMLDivElement, props: Record<string, unknown> = {}): void {
  act(() => {
    render(h(TestHarness, props), root);
    vi.advanceTimersByTime(0);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("useCrashRecovery", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDetectCrash.mockReturnValue(noCrash());
    mockWasRecoveryShown.mockReturnValue(false);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
    vi.useRealTimers();
  });

  // ─── No crash ───────────────────────────────────────────────────────

  describe("no crash scenario", () => {
    it("reports safe defaults when no crash detected", () => {
      renderAndFlush(root);
      expect(hookResult.crashed).toBe(false);
      expect(hookResult.showRecovery).toBe(false);
      expect(hookResult.crashLoop).toBe(false);
      expect(hookResult.recentCrashCount).toBe(0);
      expect(hookResult.recoveredState).toBeNull();
    });

    it("calls detectCrash once on mount", () => {
      renderAndFlush(root);
      expect(mockDetectCrash).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Crash detected ────────────────────────────────────────────────

  describe("crash detected", () => {
    it("reports crashed=true and showRecovery=true", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root);
      expect(hookResult.crashed).toBe(true);
      expect(hookResult.showRecovery).toBe(true);
    });

    it("exposes recovered navigation state", () => {
      const state = makeNavState({ view: "graph", selectedFile: "src/app.ts" });
      mockDetectCrash.mockReturnValue(crashed({ recoveredState: state }));

      renderAndFlush(root);
      expect(hookResult.recoveredState).not.toBeNull();
      expect(hookResult.recoveredState!.view).toBe("graph");
      expect(hookResult.recoveredState!.selectedFile).toBe("src/app.ts");
    });
  });

  // ─── Dismiss ────────────────────────────────────────────────────────

  describe("dismiss action", () => {
    it("hides recovery banner after dismiss", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root);
      expect(hookResult.showRecovery).toBe(true);

      act(() => { hookResult.dismiss(); });
      expect(hookResult.showRecovery).toBe(false);
    });

    it("marks recovery as shown and clears saved state", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root);

      act(() => { hookResult.dismiss(); });
      expect(mockMarkRecoveryShown).toHaveBeenCalledTimes(1);
      expect(mockClearSavedNavigationState).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Restore ────────────────────────────────────────────────────────

  describe("restore action", () => {
    it("returns the recovered state when restoring", () => {
      const state = makeNavState({ view: "prd", selectedZone: "web-dashboard" });
      mockDetectCrash.mockReturnValue(crashed({ recoveredState: state }));

      renderAndFlush(root);
      let restored: SavedNavigationState | null = null;
      act(() => { restored = hookResult.restore(); });

      expect(restored).not.toBeNull();
      expect(restored!.view).toBe("prd");
      expect(restored!.selectedZone).toBe("web-dashboard");
    });

    it("returns null when no state to restore", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root);

      let restored: SavedNavigationState | null = null;
      act(() => { restored = hookResult.restore(); });
      expect(restored).toBeNull();
    });

    it("hides recovery and clears state after restore", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root);

      act(() => { hookResult.restore(); });
      expect(hookResult.showRecovery).toBe(false);
      expect(mockMarkRecoveryShown).toHaveBeenCalledTimes(1);
      expect(mockClearSavedNavigationState).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Navigation state saving ───────────────────────────────────────

  describe("navigation state saving", () => {
    it("saves navigation state on render", () => {
      renderAndFlush(root, { view: "files", selectedFile: "index.ts" });
      expect(mockSaveNavigationState).toHaveBeenCalledWith(
        expect.objectContaining({ view: "files", selectedFile: "index.ts" }),
      );
    });
  });

  // ─── Disabled mode ─────────────────────────────────────────────────

  describe("disabled mode", () => {
    it("does not call detectCrash when disabled", () => {
      mockDetectCrash.mockReturnValue(crashed());
      renderAndFlush(root, { enabled: false });
      expect(mockDetectCrash).not.toHaveBeenCalled();
      expect(hookResult.crashed).toBe(false);
    });

    it("does not save navigation state when disabled", () => {
      renderAndFlush(root, { enabled: false, view: "graph" });
      expect(mockSaveNavigationState).not.toHaveBeenCalled();
    });
  });

  // ─── Crash loop ────────────────────────────────────────────────────

  describe("crash loop detection", () => {
    it("exposes crash loop state from detection result", () => {
      mockDetectCrash.mockReturnValue(crashed({ crashLoop: true, recentCrashCount: 3 }));
      renderAndFlush(root);
      expect(hookResult.crashed).toBe(true);
      expect(hookResult.crashLoop).toBe(true);
      expect(hookResult.recentCrashCount).toBe(3);
    });
  });

  // ─── Recovery already shown ────────────────────────────────────────

  describe("recovery already shown", () => {
    it("does not show recovery when already shown this session", () => {
      mockDetectCrash.mockReturnValue(crashed());
      mockWasRecoveryShown.mockReturnValue(true);
      renderAndFlush(root);
      expect(hookResult.crashed).toBe(true);
      expect(hookResult.showRecovery).toBe(false);
    });
  });

  // ─── Caching ───────────────────────────────────────────────────────

  describe("detection caching", () => {
    it("only calls detectCrash once even after re-render", () => {
      renderAndFlush(root);
      renderAndFlush(root, { view: "graph" });
      expect(mockDetectCrash).toHaveBeenCalledTimes(1);
    });
  });
});
