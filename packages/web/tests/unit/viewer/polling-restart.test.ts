// @vitest-environment jsdom
/**
 * Tests for the polling restart coordinator.
 *
 * Verifies that graceful-degradation state changes correctly drive
 * global polling suspension and resumption via polling-state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track degradation listeners so tests can emit events
const degradationListeners: Array<(state: { disabledFeatures: Set<string> }) => void> = [];
let featureDisabledResult = false;

vi.mock("../../../src/viewer/performance/graceful-degradation.js", () => ({
  onDegradationChange: (handler: (state: { disabledFeatures: Set<string> }) => void) => {
    degradationListeners.push(handler);
    return () => {
      const idx = degradationListeners.indexOf(handler);
      if (idx >= 0) degradationListeners.splice(idx, 1);
    };
  },
  isFeatureDisabled: (feature: string) => {
    if (feature === "autoRefresh") return featureDisabledResult;
    return false;
  },
}));

vi.mock("../../../src/viewer/polling/polling-state.js", () => ({
  suspendAllSources: vi.fn(),
  resumeAllSources: vi.fn(),
  isGlobalSuspended: vi.fn(() => false),
  getGeneration: vi.fn(() => 0),
  isGenerationCurrent: vi.fn(() => true),
}));

import {
  startPollingRestart,
  stopPollingRestart,
} from "../../../src/viewer/polling/polling-restart.js";

import {
  suspendAllSources,
  resumeAllSources,
} from "../../../src/viewer/polling/polling-state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitDegradation(disabledFeatures: string[]): void {
  const state = { disabledFeatures: new Set(disabledFeatures) };
  for (const listener of [...degradationListeners]) {
    listener(state);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("polling-restart coordinator", () => {
  beforeEach(() => {
    featureDisabledResult = false;
    degradationListeners.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopPollingRestart();
  });

  it("subscribes to degradation changes on start", () => {
    expect(degradationListeners).toHaveLength(0);
    startPollingRestart();
    expect(degradationListeners).toHaveLength(1);
  });

  it("does not suspend sources when autoRefresh is enabled at start", () => {
    featureDisabledResult = false;
    startPollingRestart();
    expect(suspendAllSources).not.toHaveBeenCalled();
  });

  it("suspends sources immediately when autoRefresh is already disabled at start", () => {
    featureDisabledResult = true;
    startPollingRestart();
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("suspends sources when degradation disables autoRefresh", () => {
    startPollingRestart();
    expect(suspendAllSources).not.toHaveBeenCalled();

    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("resumes sources when degradation re-enables autoRefresh", () => {
    startPollingRestart();

    // Suspend first
    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);

    // Re-enable
    emitDegradation([]);
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not double-suspend on repeated degradation events", () => {
    startPollingRestart();

    emitDegradation(["autoRefresh"]);
    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not resume if coordinator did not suspend", () => {
    startPollingRestart();

    // autoRefresh was never disabled, so re-enabling should not resume
    emitDegradation([]);
    expect(resumeAllSources).not.toHaveBeenCalled();
  });

  it("resumes sources on stop if coordinator had suspended them", () => {
    startPollingRestart();
    emitDegradation(["autoRefresh"]);

    stopPollingRestart();
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not resume on stop if coordinator did not suspend", () => {
    startPollingRestart();

    stopPollingRestart();
    expect(resumeAllSources).not.toHaveBeenCalled();
  });

  it("unsubscribes from degradation on stop", () => {
    startPollingRestart();
    expect(degradationListeners).toHaveLength(1);

    stopPollingRestart();
    expect(degradationListeners).toHaveLength(0);
  });

  it("restarts cleanly when called multiple times", () => {
    startPollingRestart();
    emitDegradation(["autoRefresh"]);

    // Restart should clean up previous state
    startPollingRestart();

    // Previous suspension should have been cleaned up
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
    // New subscription should be in place
    expect(degradationListeners).toHaveLength(1);
  });
});
