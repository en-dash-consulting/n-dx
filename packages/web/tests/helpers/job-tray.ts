/**
 * Stub {@link JobTray} for view tests.
 *
 * Every view that can start a long-running command takes the shared job tray
 * as a prop (see `ViewRenderContext.jobs`). Most tests are about something
 * else entirely and only need *a* tray, so they take one from here rather
 * than each inventing its own shape — which is how the prop and its stubs
 * drift apart.
 */

import type { ActiveOperation, JobTray } from "../../src/viewer/hooks/use-active-operations.js";

/** A tray with nothing running and no-op actions. */
export function emptyJobTray(): JobTray {
  return { operations: [], refresh: async () => {}, stop: async () => {} };
}

/** A tray reporting `operations`, with the actions recorded in `stopped`. */
export function jobTrayWith(
  operations: ActiveOperation[],
  stopped: ActiveOperation[] = [],
): JobTray {
  return {
    operations,
    refresh: async () => {},
    stop: async (op) => { stopped.push(op); },
  };
}

/** An {@link ActiveOperation} with test-friendly defaults. */
export function makeOperation(overrides: Partial<ActiveOperation> = {}): ActiveOperation {
  return {
    id: "sv-analyze:singleton",
    kind: "sv-analyze",
    label: "Full codebase analysis",
    status: "running",
    startedAt: "2026-08-26T10:00:00.000Z",
    finishedAt: null,
    detail: undefined,
    error: null,
    stopUrl: "/api/commands/sv-analyze/stop",
    result: { view: "analysis", label: "View analysis" },
    ...overrides,
  };
}
