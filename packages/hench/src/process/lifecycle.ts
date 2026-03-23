/**
 * Process lifecycle validation, orphan detection, and resource monitoring.
 *
 * Ensures hench processes properly release resources on completion and
 * detects resource leaks or orphaned processes that failed to clean up.
 *
 * Works alongside {@link ProcessLimiter} — the limiter controls concurrency
 * at acquire/release time, while the lifecycle validator audits cleanup
 * after the fact, detects orphans, and monitors resource usage.
 *
 * Key capabilities:
 * - **Termination validation**: verify a process released its lock file
 * - **Orphan detection**: find dead-PID lock files and stale "running" records
 * - **Automatic cleanup**: remove orphaned locks and mark stale runs as failed
 * - **Resource monitoring**: check heap/RSS against configurable thresholds
 * - **Audit trail**: structured event log for debugging process lifecycle
 *
 * @module hench/process/lifecycle
 */

import { readdir, writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HENCH_FILES } from "../constants.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCKS_DIR = "locks";
const RUNS_DIR = HENCH_FILES.RUNS;
const LIFECYCLE_DIR = "lifecycle";

/** Default stale run threshold: 2 minutes without activity. */
const DEFAULT_STALE_RUN_THRESHOLD_MS = 120_000;

/** Default resource thresholds (generous — only flag serious leaks). */
const DEFAULT_THRESHOLDS: ResourceThresholds = {
  heapUsedMB: 1024,
  rssMB: 2048,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A lifecycle event recorded in the audit trail.
 *
 * Events track the full process lifecycle: start, lock acquisition,
 * resource checks, orphan cleanup, termination, and threshold alerts.
 */
export interface LifecycleEvent {
  /** Event type identifier. */
  type:
    | "process_started"
    | "process_terminated"
    | "lock_acquired"
    | "lock_released"
    | "resource_check"
    | "resource_threshold_exceeded"
    | "orphan_detected"
    | "orphan_cleaned"
    | "stale_run_detected"
    | "stale_run_cleaned";
  /** PID of the process this event relates to. */
  pid: number;
  /** ISO timestamp of when the event occurred. */
  timestamp: string;
  /** Optional task ID associated with this process. */
  taskId?: string;
  /** Optional structured metadata. */
  detail?: Record<string, unknown>;
}

/**
 * Result of validating a process's termination cleanup.
 */
export interface TerminationReport {
  /** Whether termination was clean (no orphaned resources). */
  clean: boolean;
  /** Whether the process's lock file was properly removed. */
  lockFileRemoved: boolean;
  /** List of issues found during validation. */
  issues: Array<{
    type: "orphaned_lock" | "stale_run";
    description: string;
  }>;
}

/**
 * Result of scanning for orphaned processes and stale runs.
 */
export interface OrphanReport {
  /** Lock files belonging to dead PIDs. */
  orphanedLocks: Array<{ pid: number; taskId?: string; startedAt: string }>;
  /** Run records in "running" status with no recent activity. */
  staleRuns: Array<{ id: string; taskId: string; lastActivityAt?: string }>;
  /** Number of resources cleaned up (locks removed + runs marked failed). */
  cleanedUp: number;
}

/**
 * Point-in-time memory snapshot of the current process.
 */
export interface ResourceSnapshot {
  pid: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  timestamp: string;
}

/**
 * Configurable memory thresholds for resource leak detection.
 */
export interface ResourceThresholds {
  /** Maximum heap used in MB before alerting. */
  heapUsedMB: number;
  /** Maximum RSS in MB before alerting. */
  rssMB: number;
}

// ---------------------------------------------------------------------------
// PID liveness check (matches limiter.ts implementation)
// ---------------------------------------------------------------------------

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// LifecycleAuditTrail
// ---------------------------------------------------------------------------

/**
 * Records structured lifecycle events for a hench process and persists
 * them to `.hench/lifecycle/` for post-mortem debugging.
 *
 * Events are accumulated in memory during the process run and flushed
 * to disk on persist(). Each persist creates a new file keyed by the
 * primary PID in the event list.
 *
 * @example
 * ```ts
 * const trail = new LifecycleAuditTrail(henchDir);
 * trail.record({ type: "process_started", pid: process.pid, timestamp: new Date().toISOString() });
 * // ... work ...
 * trail.record({ type: "process_terminated", pid: process.pid, timestamp: new Date().toISOString() });
 * await trail.persist();
 * ```
 */
export class LifecycleAuditTrail {
  private readonly _henchDir: string;
  private _events: LifecycleEvent[] = [];

  constructor(henchDir: string) {
    this._henchDir = henchDir;
  }

  /** Current events (not yet persisted). */
  get events(): readonly LifecycleEvent[] {
    return this._events;
  }

  /** Record a lifecycle event. */
  record(event: LifecycleEvent): void {
    this._events.push(event);
  }

  /**
   * Persist accumulated events to disk and clear the buffer.
   *
   * Writes to `.hench/lifecycle/{pid}-{timestamp}.json`. No-ops when
   * there are no events to persist.
   */
  async persist(): Promise<void> {
    if (this._events.length === 0) return;

    const dir = join(this._henchDir, LIFECYCLE_DIR);
    await mkdir(dir, { recursive: true });

    // Use the PID from the first event as the primary identifier
    const pid = this._events[0]!.pid;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${pid}-${ts}.json`;

    const data = {
      pid,
      recordedAt: new Date().toISOString(),
      events: [...this._events],
    };

    await writeFile(join(dir, filename), JSON.stringify(data, null, 2), "utf-8");
    this._events = [];
  }
}

// ---------------------------------------------------------------------------
// ProcessLifecycleValidator options
// ---------------------------------------------------------------------------

export interface ProcessLifecycleValidatorOptions {
  /** Memory thresholds for resource leak detection. */
  thresholds?: ResourceThresholds;
  /** Duration (ms) after which a "running" record with no activity is stale. */
  staleRunThresholdMs?: number;
  /** Audit trail instance for recording lifecycle events. */
  auditTrail?: LifecycleAuditTrail;
}

// ---------------------------------------------------------------------------
// ProcessLifecycleValidator
// ---------------------------------------------------------------------------

/**
 * Validates process lifecycle cleanup, detects orphaned processes,
 * and monitors resource usage.
 *
 * Designed to be instantiated once per `hench run` (or on-demand for
 * diagnostic scans) and used throughout the process lifecycle.
 *
 * @example
 * ```ts
 * const validator = new ProcessLifecycleValidator(henchDir, {
 *   thresholds: { heapUsedMB: 512, rssMB: 1024 },
 *   staleRunThresholdMs: 120_000,
 * });
 *
 * // Periodic resource check
 * const alerts = validator.checkResourceThresholds();
 * if (alerts.length > 0) console.warn("Resource alerts:", alerts);
 *
 * // On shutdown: validate cleanup
 * const report = await validator.validateTermination(process.pid);
 * if (!report.clean) console.warn("Cleanup issues:", report.issues);
 *
 * // Maintenance: detect and clean orphans
 * const orphans = await validator.cleanupOrphans();
 * console.log(`Cleaned up ${orphans.cleanedUp} orphaned resources`);
 * ```
 */
export class ProcessLifecycleValidator {
  private readonly _henchDir: string;
  private readonly _thresholds: ResourceThresholds;
  private readonly _staleRunThresholdMs: number;
  private readonly _auditTrail: LifecycleAuditTrail | undefined;

  constructor(henchDir: string, options?: ProcessLifecycleValidatorOptions) {
    this._henchDir = henchDir;
    this._thresholds = options?.thresholds ?? { ...DEFAULT_THRESHOLDS };
    this._staleRunThresholdMs = options?.staleRunThresholdMs ?? DEFAULT_STALE_RUN_THRESHOLD_MS;
    this._auditTrail = options?.auditTrail;
  }

  // -------------------------------------------------------------------------
  // Termination validation
  // -------------------------------------------------------------------------

  /**
   * Validate that a process properly released its resources.
   *
   * Checks:
   * 1. Lock file for the given PID has been removed (or PID is alive)
   * 2. No orphaned state left behind
   *
   * @param pid  The PID to validate termination for.
   */
  async validateTermination(pid: number): Promise<TerminationReport> {
    const issues: TerminationReport["issues"] = [];

    // Check lock file
    const lockExists = await this._lockFileExists(pid);
    const alive = isPidAlive(pid);

    if (lockExists && !alive) {
      issues.push({
        type: "orphaned_lock",
        description: `Lock file for dead PID ${pid} still exists`,
      });
    }

    const lockFileRemoved = !lockExists;

    return {
      clean: issues.length === 0,
      lockFileRemoved,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Orphan detection
  // -------------------------------------------------------------------------

  /**
   * Scan for orphaned processes and stale run records.
   *
   * Orphaned locks: lock files whose PIDs are no longer alive.
   * Stale runs: records in "running" status whose `lastActivityAt` exceeds
   * the configured stale threshold.
   *
   * Does NOT clean up — use {@link cleanupOrphans} for that.
   */
  async detectOrphans(): Promise<OrphanReport> {
    const orphanedLocks = await this._findOrphanedLocks();
    const staleRuns = await this._findStaleRuns();

    return {
      orphanedLocks,
      staleRuns,
      cleanedUp: 0,
    };
  }

  /**
   * Detect and clean up orphaned resources.
   *
   * - Removes orphaned lock files
   * - Marks stale "running" records as "failed" with an orphan error message
   * - Records audit events for each cleanup action
   *
   * @returns Report with details of what was found and cleaned.
   */
  async cleanupOrphans(): Promise<OrphanReport> {
    const orphanedLocks = await this._findOrphanedLocks();
    const staleRuns = await this._findStaleRuns();
    let cleanedUp = 0;

    // Clean orphaned lock files
    for (const lock of orphanedLocks) {
      const lockPath = join(this._henchDir, LOCKS_DIR, `${lock.pid}.lock`);
      try {
        await unlink(lockPath);
        cleanedUp++;

        this._auditTrail?.record({
          type: "orphan_cleaned",
          pid: lock.pid,
          timestamp: new Date().toISOString(),
          taskId: lock.taskId,
          detail: { resource: "lock_file", path: lockPath },
        });
      } catch {
        // Lock file already gone — fine
      }
    }

    // Mark stale runs as failed
    for (const staleRun of staleRuns) {
      try {
        const runPath = join(this._henchDir, RUNS_DIR, `${staleRun.id}.json`);
        const raw = await readFile(runPath, "utf-8");
        const record = JSON.parse(raw);

        record.status = "failed";
        record.error = `Process orphaned: no activity since ${staleRun.lastActivityAt ?? "unknown"}`;
        record.finishedAt = new Date().toISOString();

        await writeFile(runPath, JSON.stringify(record, null, 2), "utf-8");
        cleanedUp++;

        this._auditTrail?.record({
          type: "stale_run_cleaned",
          pid: 0,
          timestamp: new Date().toISOString(),
          taskId: staleRun.taskId,
          detail: { runId: staleRun.id, lastActivityAt: staleRun.lastActivityAt },
        });
      } catch {
        // Run file read/write failed — skip
      }
    }

    return {
      orphanedLocks,
      staleRuns,
      cleanedUp,
    };
  }

  // -------------------------------------------------------------------------
  // Resource monitoring
  // -------------------------------------------------------------------------

  /**
   * Take a point-in-time memory snapshot of the current process.
   */
  takeResourceSnapshot(): ResourceSnapshot {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

    return {
      pid: process.pid,
      heapUsedMB: toMB(mem.heapUsed),
      heapTotalMB: toMB(mem.heapTotal),
      rssMB: toMB(mem.rss),
      externalMB: toMB(mem.external),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check current resource usage against configured thresholds.
   *
   * @returns Array of human-readable alert strings. Empty if all OK.
   */
  checkResourceThresholds(): string[] {
    const snapshot = this.takeResourceSnapshot();
    const alerts: string[] = [];

    if (snapshot.heapUsedMB > this._thresholds.heapUsedMB) {
      alerts.push(
        `heap used (${snapshot.heapUsedMB}MB) exceeds threshold (${this._thresholds.heapUsedMB}MB)`,
      );
    }

    if (snapshot.rssMB > this._thresholds.rssMB) {
      alerts.push(
        `RSS (${snapshot.rssMB}MB) exceeds threshold (${this._thresholds.rssMB}MB)`,
      );
    }

    if (alerts.length > 0) {
      this._auditTrail?.record({
        type: "resource_threshold_exceeded",
        pid: process.pid,
        timestamp: snapshot.timestamp,
        detail: {
          heapUsedMB: snapshot.heapUsedMB,
          rssMB: snapshot.rssMB,
          thresholds: { ...this._thresholds },
          alerts,
        },
      });
    }

    return alerts;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _lockFileExists(pid: number): Promise<boolean> {
    try {
      await readFile(join(this._henchDir, LOCKS_DIR, `${pid}.lock`), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  private async _findOrphanedLocks(): Promise<OrphanReport["orphanedLocks"]> {
    const dir = join(this._henchDir, LOCKS_DIR);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const lockFiles = entries.filter((f) => f.endsWith(".lock"));
    const orphaned: OrphanReport["orphanedLocks"] = [];

    for (const file of lockFiles) {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const data = JSON.parse(raw);

        if (!isPidAlive(data.pid)) {
          orphaned.push({
            pid: data.pid,
            taskId: data.taskId,
            startedAt: data.startedAt,
          });
        }
      } catch {
        // Corrupted lock file — treat as orphaned with unknown PID
        const pidMatch = file.match(/^(\d+)\.lock$/);
        if (pidMatch) {
          orphaned.push({
            pid: parseInt(pidMatch[1]!, 10),
            startedAt: new Date().toISOString(),
          });
        }
      }
    }

    return orphaned;
  }

  private async _findStaleRuns(): Promise<OrphanReport["staleRuns"]> {
    const dir = join(this._henchDir, RUNS_DIR);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const stale: OrphanReport["staleRuns"] = [];
    const now = Date.now();

    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const record = JSON.parse(raw);

        if (record.status !== "running") continue;

        const lastActivity = record.lastActivityAt ?? record.startedAt;
        const age = now - new Date(lastActivity).getTime();

        if (age > this._staleRunThresholdMs) {
          stale.push({
            id: record.id,
            taskId: record.taskId,
            lastActivityAt: record.lastActivityAt,
          });
        }
      } catch {
        // Skip unreadable run files
      }
    }

    return stale;
  }
}
