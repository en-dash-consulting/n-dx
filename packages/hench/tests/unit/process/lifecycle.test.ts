import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProcessLifecycleValidator,
  LifecycleAuditTrail,
  type LifecycleEvent,
  type TerminationReport,
  type OrphanReport,
  type ResourceSnapshot,
  type ResourceThresholds,
} from "../../../src/process/lifecycle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeLockFile(
  henchDir: string,
  pid: number,
  extra?: { taskId?: string; startedAt?: string },
): Promise<void> {
  const locksDir = join(henchDir, "locks");
  await mkdir(locksDir, { recursive: true });
  await writeFile(
    join(locksDir, `${pid}.lock`),
    JSON.stringify({
      pid,
      startedAt: extra?.startedAt ?? new Date().toISOString(),
      ...(extra?.taskId ? { taskId: extra.taskId } : {}),
    }),
  );
}

async function writeRunRecord(
  henchDir: string,
  id: string,
  overrides?: Record<string, unknown>,
): Promise<void> {
  const runsDir = join(henchDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    id,
    taskId: "task-1",
    taskTitle: "Test Task",
    startedAt: new Date().toISOString(),
    status: "running",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
  await writeFile(join(runsDir, `${id}.json`), JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// LifecycleAuditTrail
// ---------------------------------------------------------------------------

describe("LifecycleAuditTrail", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-lifecycle-test-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("records events and persists them", async () => {
    const trail = new LifecycleAuditTrail(henchDir);
    trail.record({
      type: "process_started",
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });

    expect(trail.events).toHaveLength(1);
    expect(trail.events[0]!.type).toBe("process_started");

    await trail.persist();

    const lifecycleDir = join(henchDir, "lifecycle");
    const files = await readdir(lifecycleDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it("records multiple events in order", () => {
    const trail = new LifecycleAuditTrail(henchDir);
    trail.record({
      type: "process_started",
      pid: 100,
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    trail.record({
      type: "resource_check",
      pid: 100,
      timestamp: "2025-01-01T00:00:01.000Z",
      detail: { heapUsedMB: 50 },
    });
    trail.record({
      type: "process_terminated",
      pid: 100,
      timestamp: "2025-01-01T00:00:02.000Z",
    });

    expect(trail.events).toHaveLength(3);
    expect(trail.events.map((e) => e.type)).toEqual([
      "process_started",
      "resource_check",
      "process_terminated",
    ]);
  });

  it("includes taskId and detail when provided", () => {
    const trail = new LifecycleAuditTrail(henchDir);
    trail.record({
      type: "lock_acquired",
      pid: 200,
      timestamp: new Date().toISOString(),
      taskId: "my-task",
      detail: { lockFile: "200.lock" },
    });

    const event = trail.events[0]!;
    expect(event.taskId).toBe("my-task");
    expect(event.detail).toEqual({ lockFile: "200.lock" });
  });

  it("persisted file contains valid JSON with all events", async () => {
    const trail = new LifecycleAuditTrail(henchDir);
    trail.record({
      type: "process_started",
      pid: 100,
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    trail.record({
      type: "process_terminated",
      pid: 100,
      timestamp: "2025-01-01T00:00:05.000Z",
    });

    await trail.persist();

    const lifecycleDir = join(henchDir, "lifecycle");
    const files = await readdir(lifecycleDir);
    const raw = await readFile(join(lifecycleDir, files[0]!), "utf-8");
    const data = JSON.parse(raw);

    expect(data.events).toHaveLength(2);
    expect(data.pid).toBe(100);
  });

  it("clears events after persist", async () => {
    const trail = new LifecycleAuditTrail(henchDir);
    trail.record({
      type: "process_started",
      pid: 1,
      timestamp: new Date().toISOString(),
    });

    await trail.persist();
    expect(trail.events).toHaveLength(0);
  });

  it("no-ops persist when no events recorded", async () => {
    const trail = new LifecycleAuditTrail(henchDir);
    await trail.persist();

    const lifecycleDir = join(henchDir, "lifecycle");
    let files: string[] = [];
    try {
      files = await readdir(lifecycleDir);
    } catch {
      // Dir may not exist — that's fine
    }
    expect(files).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ProcessLifecycleValidator — termination validation
// ---------------------------------------------------------------------------

describe("ProcessLifecycleValidator", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-lifecycle-test-"));
    await mkdir(join(henchDir, "locks"), { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  describe("validateTermination", () => {
    it("reports clean termination when lock is released", async () => {
      const validator = new ProcessLifecycleValidator(henchDir);

      // No lock file exists for the PID — clean termination
      const report = await validator.validateTermination(999999999);

      expect(report.clean).toBe(true);
      expect(report.lockFileRemoved).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it("detects orphaned lock file after termination", async () => {
      // Create a lock for a dead PID
      const deadPid = 999999999;
      await writeLockFile(henchDir, deadPid, { taskId: "task-1" });

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.validateTermination(deadPid);

      expect(report.clean).toBe(false);
      expect(report.lockFileRemoved).toBe(false);
      expect(report.issues).toContainEqual(
        expect.objectContaining({ type: "orphaned_lock" }),
      );
    });

    it("detects stale running run record after process death", async () => {
      const deadPid = 999999999;
      await writeRunRecord(henchDir, "run-1", {
        status: "running",
        lastActivityAt: new Date(Date.now() - 120_000).toISOString(),
      });

      // Write lock file pointing at dead pid with a matching task
      await writeLockFile(henchDir, deadPid, { taskId: "task-1" });

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.validateTermination(deadPid);

      expect(report.clean).toBe(false);
      expect(report.issues.some((i) => i.type === "orphaned_lock")).toBe(true);
    });

    it("reports clean when process is alive and holding lock", async () => {
      // Current PID is alive, holding a lock is expected
      await writeLockFile(henchDir, process.pid, { taskId: "task-1" });

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.validateTermination(process.pid);

      // Lock exists but process is alive — not orphaned, considered clean
      expect(report.clean).toBe(true);
      expect(report.lockFileRemoved).toBe(false);
      expect(report.issues).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Orphaned process detection
  // ---------------------------------------------------------------------------

  describe("detectOrphans", () => {
    it("returns empty report when no orphans exist", async () => {
      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.detectOrphans();

      expect(report.orphanedLocks).toHaveLength(0);
      expect(report.staleRuns).toHaveLength(0);
      expect(report.cleanedUp).toBe(0);
    });

    it("detects orphaned lock files from dead PIDs", async () => {
      const deadPid = 999999999;
      await writeLockFile(henchDir, deadPid, { taskId: "task-1" });

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.detectOrphans();

      expect(report.orphanedLocks).toHaveLength(1);
      expect(report.orphanedLocks[0]!.pid).toBe(deadPid);
    });

    it("does not flag live process locks as orphaned", async () => {
      await writeLockFile(henchDir, process.pid, { taskId: "task-1" });

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.detectOrphans();

      expect(report.orphanedLocks).toHaveLength(0);
    });

    it("detects stale running run records", async () => {
      // A run record in "running" status with very old lastActivityAt
      await writeRunRecord(henchDir, "stale-run", {
        status: "running",
        lastActivityAt: new Date(Date.now() - 600_000).toISOString(), // 10 min old
      });

      const validator = new ProcessLifecycleValidator(henchDir, {
        staleRunThresholdMs: 120_000, // 2 minutes
      });
      const report = await validator.detectOrphans();

      expect(report.staleRuns).toHaveLength(1);
      expect(report.staleRuns[0]!.id).toBe("stale-run");
    });

    it("does not flag recent running records as stale", async () => {
      await writeRunRecord(henchDir, "active-run", {
        status: "running",
        lastActivityAt: new Date().toISOString(),
      });

      const validator = new ProcessLifecycleValidator(henchDir, {
        staleRunThresholdMs: 120_000,
      });
      const report = await validator.detectOrphans();

      expect(report.staleRuns).toHaveLength(0);
    });

    it("does not flag completed runs as stale", async () => {
      await writeRunRecord(henchDir, "done-run", {
        status: "completed",
        lastActivityAt: new Date(Date.now() - 600_000).toISOString(),
      });

      const validator = new ProcessLifecycleValidator(henchDir, {
        staleRunThresholdMs: 120_000,
      });
      const report = await validator.detectOrphans();

      expect(report.staleRuns).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Orphan cleanup
  // ---------------------------------------------------------------------------

  describe("cleanupOrphans", () => {
    it("removes orphaned lock files", async () => {
      const deadPid = 999999999;
      await writeLockFile(henchDir, deadPid);

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.cleanupOrphans();

      expect(report.cleanedUp).toBeGreaterThanOrEqual(1);

      const lockFiles = await readdir(join(henchDir, "locks"));
      expect(lockFiles).toHaveLength(0);
    });

    it("marks stale running records as failed", async () => {
      await writeRunRecord(henchDir, "stale-run", {
        status: "running",
        lastActivityAt: new Date(Date.now() - 600_000).toISOString(),
      });

      const validator = new ProcessLifecycleValidator(henchDir, {
        staleRunThresholdMs: 120_000,
      });
      const report = await validator.cleanupOrphans();

      expect(report.staleRuns).toHaveLength(1);
      expect(report.cleanedUp).toBeGreaterThanOrEqual(1);

      // Verify the run record was updated
      const raw = await readFile(join(henchDir, "runs", "stale-run.json"), "utf-8");
      const record = JSON.parse(raw);
      expect(record.status).toBe("failed");
      expect(record.error).toContain("orphan");
    });

    it("does not modify live process locks", async () => {
      await writeLockFile(henchDir, process.pid);

      const validator = new ProcessLifecycleValidator(henchDir);
      const report = await validator.cleanupOrphans();

      expect(report.cleanedUp).toBe(0);

      const lockFiles = await readdir(join(henchDir, "locks"));
      expect(lockFiles).toHaveLength(1);
    });

    it("records audit events for each cleanup action", async () => {
      const deadPid = 999999999;
      await writeLockFile(henchDir, deadPid, { taskId: "task-orphan" });

      const trail = new LifecycleAuditTrail(henchDir);
      const validator = new ProcessLifecycleValidator(henchDir, { auditTrail: trail });
      await validator.cleanupOrphans();

      expect(trail.events.length).toBeGreaterThanOrEqual(1);
      expect(trail.events.some((e) => e.type === "orphan_cleaned")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Resource snapshot
  // ---------------------------------------------------------------------------

  describe("takeResourceSnapshot", () => {
    it("returns memory usage info for current process", () => {
      const validator = new ProcessLifecycleValidator(henchDir);
      const snapshot = validator.takeResourceSnapshot();

      expect(snapshot.pid).toBe(process.pid);
      expect(snapshot.heapUsedMB).toBeGreaterThan(0);
      expect(snapshot.heapTotalMB).toBeGreaterThan(0);
      expect(snapshot.rssMB).toBeGreaterThan(0);
      expect(snapshot.timestamp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Resource leak alerts
  // ---------------------------------------------------------------------------

  describe("checkResourceThresholds", () => {
    it("returns no alerts when under thresholds", () => {
      const thresholds: ResourceThresholds = {
        heapUsedMB: 10_000, // Very high — won't trigger in tests
        rssMB: 10_000,
      };

      const validator = new ProcessLifecycleValidator(henchDir, { thresholds });
      const alerts = validator.checkResourceThresholds();

      expect(alerts).toHaveLength(0);
    });

    it("returns alert when heap exceeds threshold", () => {
      const thresholds: ResourceThresholds = {
        heapUsedMB: 0.001, // Essentially 0 — will always trigger
        rssMB: 10_000,
      };

      const validator = new ProcessLifecycleValidator(henchDir, { thresholds });
      const alerts = validator.checkResourceThresholds();

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts.some((a) => a.includes("heap"))).toBe(true);
    });

    it("returns alert when RSS exceeds threshold", () => {
      const thresholds: ResourceThresholds = {
        heapUsedMB: 10_000,
        rssMB: 0.001,
      };

      const validator = new ProcessLifecycleValidator(henchDir, { thresholds });
      const alerts = validator.checkResourceThresholds();

      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts.some((a) => a.includes("RSS"))).toBe(true);
    });

    it("uses default thresholds when none configured", () => {
      const validator = new ProcessLifecycleValidator(henchDir);
      // Default thresholds are high enough that no alerts should fire in test
      const alerts = validator.checkResourceThresholds();
      expect(alerts).toBeInstanceOf(Array);
    });

    it("records audit event when threshold exceeded", () => {
      const thresholds: ResourceThresholds = {
        heapUsedMB: 0.001,
        rssMB: 10_000,
      };

      const trail = new LifecycleAuditTrail(henchDir);
      const validator = new ProcessLifecycleValidator(henchDir, {
        thresholds,
        auditTrail: trail,
      });
      validator.checkResourceThresholds();

      expect(trail.events.some((e) => e.type === "resource_threshold_exceeded")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Constructor options
  // ---------------------------------------------------------------------------

  describe("constructor", () => {
    it("accepts default options", () => {
      const validator = new ProcessLifecycleValidator(henchDir);
      expect(validator).toBeDefined();
    });

    it("accepts custom thresholds", () => {
      const validator = new ProcessLifecycleValidator(henchDir, {
        thresholds: { heapUsedMB: 512, rssMB: 1024 },
      });
      expect(validator).toBeDefined();
    });

    it("accepts a custom stale run threshold", () => {
      const validator = new ProcessLifecycleValidator(henchDir, {
        staleRunThresholdMs: 60_000,
      });
      expect(validator).toBeDefined();
    });
  });
});
