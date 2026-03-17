// @vitest-environment jsdom
/**
 * Tests for the crash detection and recovery module.
 *
 * Covers: heartbeat lifecycle, crash detection, crash loop detection,
 * navigation state save/restore, crash history management, storage
 * unavailability fallback, and module reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectCrash,
  saveNavigationState,
  clearSavedNavigationState,
  markRecoveryShown,
  wasRecoveryShown,
  getDetectionResult,
  clearCrashHistory,
  resetCrashDetector,
  type CrashDetectionResult,
  type SavedNavigationState,
} from "../../../src/viewer/crash/crash-detector.js";
import {
  HEARTBEAT_KEY,
  NAV_STATE_KEY,
  CRASH_HISTORY_KEY,
  RECOVERY_SHOWN_KEY,
  CRASH_LOOP_WINDOW_MS,
  CRASH_LOOP_THRESHOLD,
  MAX_CRASH_HISTORY,
} from "../../helpers/crash-detector-test-support.js";

describe("crash-detector", () => {
  beforeEach(() => {
    resetCrashDetector();
    sessionStorage.clear();
  });

  afterEach(() => {
    resetCrashDetector();
    sessionStorage.clear();
  });

  describe("detectCrash — no previous crash", () => {
    it("returns crashed=false when no heartbeat is present", () => {
      const result = detectCrash();
      expect(result.crashed).toBe(false);
      expect(result.crashLoop).toBe(false);
      expect(result.recentCrashCount).toBe(0);
      expect(result.recoveredState).toBeNull();
    });

    it("sets the heartbeat after detection", () => {
      detectCrash();
      expect(sessionStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();
    });

    it("returns cached result on subsequent calls", () => {
      const r1 = detectCrash();
      const r2 = detectCrash();
      expect(r1).toBe(r2);
    });
  });

  describe("detectCrash — crash detected", () => {
    it("returns crashed=true when heartbeat is present", () => {
      // Simulate previous session leaving heartbeat.
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      const result = detectCrash();
      expect(result.crashed).toBe(true);
    });

    it("recovers saved navigation state", () => {
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());
      const saved: SavedNavigationState = {
        view: "graph",
        selectedFile: "src/main.ts",
        selectedZone: null,
        selectedRunId: null,
        selectedTaskId: null,
        timestamp: new Date().toISOString(),
      };
      sessionStorage.setItem(NAV_STATE_KEY, JSON.stringify(saved));

      const result = detectCrash();
      expect(result.crashed).toBe(true);
      expect(result.recoveredState).not.toBeNull();
      expect(result.recoveredState!.view).toBe("graph");
      expect(result.recoveredState!.selectedFile).toBe("src/main.ts");
    });

    it("records the crash in history", () => {
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      detectCrash();

      const history = JSON.parse(sessionStorage.getItem(CRASH_HISTORY_KEY) ?? "[]");
      expect(history.length).toBe(1);
      expect(history[0]).toHaveProperty("timestamp");
    });
  });

  describe("crash loop detection", () => {
    it("detects a crash loop when multiple recent crashes exist", () => {
      // Pre-populate crash history with recent entries.
      const recentCrashes = Array.from({ length: CRASH_LOOP_THRESHOLD - 1 }, () => ({
        timestamp: new Date().toISOString(),
      }));
      sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify(recentCrashes));
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      const result = detectCrash();
      expect(result.crashed).toBe(true);
      expect(result.crashLoop).toBe(true);
      expect(result.recentCrashCount).toBeGreaterThanOrEqual(CRASH_LOOP_THRESHOLD);
    });

    it("does not flag crash loop for a single crash", () => {
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      const result = detectCrash();
      expect(result.crashed).toBe(true);
      expect(result.crashLoop).toBe(false);
      expect(result.recentCrashCount).toBe(1);
    });

    it("ignores old crashes outside the loop window", () => {
      const oldTimestamp = new Date(Date.now() - CRASH_LOOP_WINDOW_MS - 60_000).toISOString();
      const oldCrashes = Array.from({ length: 5 }, () => ({
        timestamp: oldTimestamp,
      }));
      sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify(oldCrashes));
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      const result = detectCrash();
      expect(result.crashed).toBe(true);
      // Only the new crash is recent.
      expect(result.recentCrashCount).toBe(1);
      expect(result.crashLoop).toBe(false);
    });
  });

  describe("navigation state save/restore", () => {
    it("saves navigation state to sessionStorage", () => {
      saveNavigationState({
        view: "prd",
        selectedFile: null,
        selectedZone: null,
        selectedRunId: null,
        selectedTaskId: "task-123",
      });

      const raw = sessionStorage.getItem(NAV_STATE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as SavedNavigationState;
      expect(parsed.view).toBe("prd");
      expect(parsed.selectedTaskId).toBe("task-123");
      expect(parsed.timestamp).toBeDefined();
    });

    it("overwrites previous state on subsequent saves", () => {
      saveNavigationState({ view: "graph", selectedFile: null, selectedZone: null, selectedRunId: null, selectedTaskId: null });
      saveNavigationState({ view: "files", selectedFile: "a.ts", selectedZone: null, selectedRunId: null, selectedTaskId: null });

      const parsed = JSON.parse(sessionStorage.getItem(NAV_STATE_KEY)!) as SavedNavigationState;
      expect(parsed.view).toBe("files");
      expect(parsed.selectedFile).toBe("a.ts");
    });

    it("clears saved state with clearSavedNavigationState", () => {
      saveNavigationState({ view: "graph", selectedFile: null, selectedZone: null, selectedRunId: null, selectedTaskId: null });
      clearSavedNavigationState();
      expect(sessionStorage.getItem(NAV_STATE_KEY)).toBeNull();
    });
  });

  describe("recovery shown tracking", () => {
    it("wasRecoveryShown returns false by default", () => {
      expect(wasRecoveryShown()).toBe(false);
    });

    it("markRecoveryShown makes wasRecoveryShown return true", () => {
      markRecoveryShown();
      expect(wasRecoveryShown()).toBe(true);
    });
  });

  describe("crash history management", () => {
    it("clearCrashHistory removes all history", () => {
      sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify([{ timestamp: new Date().toISOString() }]));
      clearCrashHistory();
      expect(sessionStorage.getItem(CRASH_HISTORY_KEY)).toBeNull();
    });

    it("crash history is bounded to MAX_CRASH_HISTORY entries", () => {
      // Simulate many crashes by pre-populating history.
      const manyEntries = Array.from({ length: MAX_CRASH_HISTORY + 5 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
      }));
      sessionStorage.setItem(CRASH_HISTORY_KEY, JSON.stringify(manyEntries));
      sessionStorage.setItem(HEARTBEAT_KEY, new Date().toISOString());

      detectCrash();

      const history = JSON.parse(sessionStorage.getItem(CRASH_HISTORY_KEY) ?? "[]");
      expect(history.length).toBeLessThanOrEqual(MAX_CRASH_HISTORY);
    });
  });

  describe("getDetectionResult", () => {
    it("returns null before detectCrash is called", () => {
      expect(getDetectionResult()).toBeNull();
    });

    it("returns the result after detectCrash is called", () => {
      detectCrash();
      expect(getDetectionResult()).not.toBeNull();
      expect(getDetectionResult()!.crashed).toBe(false);
    });
  });

  describe("resetCrashDetector", () => {
    it("clears all module state and storage", () => {
      sessionStorage.setItem(HEARTBEAT_KEY, "test");
      sessionStorage.setItem(NAV_STATE_KEY, "{}");
      sessionStorage.setItem(CRASH_HISTORY_KEY, "[]");
      sessionStorage.setItem(RECOVERY_SHOWN_KEY, "true");

      detectCrash();
      resetCrashDetector();

      expect(getDetectionResult()).toBeNull();
      expect(sessionStorage.getItem(HEARTBEAT_KEY)).toBeNull();
      expect(sessionStorage.getItem(NAV_STATE_KEY)).toBeNull();
      expect(sessionStorage.getItem(CRASH_HISTORY_KEY)).toBeNull();
      expect(sessionStorage.getItem(RECOVERY_SHOWN_KEY)).toBeNull();
    });
  });

  describe("beforeunload handler", () => {
    it("clears heartbeat on clean unload", () => {
      detectCrash();
      expect(sessionStorage.getItem(HEARTBEAT_KEY)).not.toBeNull();

      // Simulate clean unload.
      window.dispatchEvent(new Event("beforeunload"));
      expect(sessionStorage.getItem(HEARTBEAT_KEY)).toBeNull();
    });
  });

  describe("storage unavailable", () => {
    it("returns safe defaults when sessionStorage throws", () => {
      // Mock sessionStorage to throw.
      const originalGetItem = sessionStorage.getItem;
      const originalSetItem = sessionStorage.setItem;
      const originalRemoveItem = sessionStorage.removeItem;
      sessionStorage.getItem = () => { throw new Error("blocked"); };
      sessionStorage.setItem = () => { throw new Error("blocked"); };
      sessionStorage.removeItem = () => { throw new Error("blocked"); };

      try {
        resetCrashDetector();
        const result = detectCrash();
        expect(result.crashed).toBe(false);
        expect(result.crashLoop).toBe(false);
        expect(result.recoveredState).toBeNull();
      } finally {
        sessionStorage.getItem = originalGetItem;
        sessionStorage.setItem = originalSetItem;
        sessionStorage.removeItem = originalRemoveItem;
      }
    });
  });
});
