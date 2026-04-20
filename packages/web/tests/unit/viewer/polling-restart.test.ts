// @vitest-environment jsdom
/**
 * Tests for the polling restart coordinator.
 *
 * Verifies that graceful-degradation state changes correctly drive
 * global polling suspension and resumption via polling-state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/viewer/polling/engine/polling-state.js", () => ({
  suspendAllSources: vi.fn(),
  resumeAllSources: vi.fn(),
  isGlobalSuspended: vi.fn(() => false),
  getGeneration: vi.fn(() => 0),
  isGenerationCurrent: vi.fn(() => true),
}));

import {
  startPollingRestart,
  stopPollingRestart,
  type PollingRestartOptions,
} from "../../../src/viewer/polling/engine/polling-restart.js";

import {
  suspendAllSources,
  resumeAllSources,
} from "../../../src/viewer/polling/engine/polling-state.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a PollingRestartOptions with controllable degradation callbacks. */
function makeOptions(): {
  options: PollingRestartOptions;
  emitDegradation: (disabledFeatures: string[]) => void;
  featureDisabledMap: Map<string, boolean>;
} {
  const listeners: Array<(state: { disabledFeatures: Set<string> }) => void> = [];
  const featureDisabledMap = new Map<string, boolean>();

  const options: PollingRestartOptions = {
    onDegradationChange: (handler) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    isFeatureDisabled: (feature: string) => featureDisabledMap.get(feature) ?? false,
  };

  const emitDegradation = (disabledFeatures: string[]) => {
    const state = { disabledFeatures: new Set(disabledFeatures) };
    for (const listener of [...listeners]) {
      listener(state);
    }
  };

  return { options, emitDegradation, featureDisabledMap };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("polling-restart coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopPollingRestart();
  });

  it("subscribes to degradation changes on start", () => {
    let subscribed = false;
    const options: PollingRestartOptions = {
      onDegradationChange: (handler) => {
        subscribed = true;
        return () => { /* no-op */ };
      },
      isFeatureDisabled: () => false,
    };
    startPollingRestart(options);
    expect(subscribed).toBe(true);
  });

  it("does not suspend sources when autoRefresh is enabled at start", () => {
    const { options } = makeOptions();
    startPollingRestart(options);
    expect(suspendAllSources).not.toHaveBeenCalled();
  });

  it("suspends sources immediately when autoRefresh is already disabled at start", () => {
    const { options, featureDisabledMap } = makeOptions();
    featureDisabledMap.set("autoRefresh", true);
    startPollingRestart(options);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("suspends sources when degradation disables autoRefresh", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);
    expect(suspendAllSources).not.toHaveBeenCalled();

    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("resumes sources when degradation re-enables autoRefresh", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);

    // Suspend first
    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);

    // Re-enable
    emitDegradation([]);
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not double-suspend on repeated degradation events", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);

    emitDegradation(["autoRefresh"]);
    emitDegradation(["autoRefresh"]);
    expect(suspendAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not resume if coordinator did not suspend", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);

    // autoRefresh was never disabled, so re-enabling should not resume
    emitDegradation([]);
    expect(resumeAllSources).not.toHaveBeenCalled();
  });

  it("resumes sources on stop if coordinator had suspended them", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);
    emitDegradation(["autoRefresh"]);

    stopPollingRestart();
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
  });

  it("does not resume on stop if coordinator did not suspend", () => {
    const { options } = makeOptions();
    startPollingRestart(options);

    stopPollingRestart();
    expect(resumeAllSources).not.toHaveBeenCalled();
  });

  it("unsubscribes from degradation on stop", () => {
    let unsubscribed = false;
    const options: PollingRestartOptions = {
      onDegradationChange: (handler) => {
        return () => { unsubscribed = true; };
      },
      isFeatureDisabled: () => false,
    };
    startPollingRestart(options);
    stopPollingRestart();
    expect(unsubscribed).toBe(true);
  });

  it("restarts cleanly when called multiple times", () => {
    const { options, emitDegradation } = makeOptions();
    startPollingRestart(options);
    emitDegradation(["autoRefresh"]);

    // Restart should clean up previous state
    const { options: options2 } = makeOptions();
    startPollingRestart(options2);

    // Previous suspension should have been cleaned up
    expect(resumeAllSources).toHaveBeenCalledTimes(1);
  });
});
