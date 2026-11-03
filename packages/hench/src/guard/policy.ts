/**
 * Session-aware policy engine — runtime enforcement with cumulative tracking.
 *
 * Unlike the static validators in commands.ts and paths.ts which check
 * individual operations in isolation, the PolicyEngine tracks cumulative
 * session state: total commands run, bytes written, and operation frequency.
 * This enables rate limiting and resource budgets that prevent runaway
 * autonomous behavior even when each individual operation is valid.
 *
 * ## Design
 *
 * - **One engine per agent run** — instantiated alongside GuardRails
 * - **Sliding-window rate limiting** — tracks operation timestamps within
 *   a configurable window to enforce per-minute limits
 * - **Cumulative resource tracking** — bytes written, commands executed,
 *   files modified are tracked across the entire session
 * - **Audit trail** — every guard decision (allow/deny) is logged with
 *   context for post-run analysis
 *
 * @module
 */

import { GuardError } from "./paths.js";

/**
 * Policy limits that can be configured per session.
 * Defaults are generous but prevent truly runaway behavior.
 */
export interface PolicyLimits {
  /** Maximum commands per minute (0 = unlimited). */
  maxCommandsPerMinute: number;
  /** Maximum file writes per minute (0 = unlimited). */
  maxWritesPerMinute: number;
  /** Maximum total bytes written in the session (0 = unlimited). */
  maxTotalBytesWritten: number;
  /** Maximum total commands in the session (0 = unlimited). */
  maxTotalCommands: number;
  /** Sliding window size in ms for per-minute rate calculations. */
  rateLimitWindowMs: number;
}

export const DEFAULT_POLICY_LIMITS: PolicyLimits = {
  maxCommandsPerMinute: 60,
  maxWritesPerMinute: 30,
  maxTotalBytesWritten: 0, // unlimited by default
  maxTotalCommands: 0,     // unlimited by default
  rateLimitWindowMs: 60_000,
};

export type OperationType =
  | "command"
  | "file_read"
  | "file_write"
  | "git"
  | "path_check"
  | "directory_list"
  | "file_search";

export type AuditVerdict = "allow" | "deny";

/**
 * A single entry in the audit trail.
 */
export interface AuditEntry {
  timestamp: number;
  operation: OperationType;
  verdict: AuditVerdict;
  /** Tool name or command that triggered the check. */
  target: string;
  /** Reason for denial, if denied. */
  reason?: string;
  /** Session counters at the time of this entry. */
  counters: SessionCounters;
}

/**
 * Snapshot of cumulative session counters.
 */
export interface SessionCounters {
  commandsRun: number;
  bytesWritten: number;
  filesRead: number;
  filesWritten: number;
  operationsTotal: number;
}

/**
 * Session-aware policy engine that tracks cumulative resource usage
 * and enforces rate limits across an agent run.
 */
export class PolicyEngine {
  private limits: PolicyLimits;

  // Cumulative counters
  private _commandsRun = 0;
  private _bytesWritten = 0;
  private _filesRead = 0;
  private _filesWritten = 0;
  private _operationsTotal = 0;

  // Sliding-window timestamps for rate limiting
  private commandTimestamps: number[] = [];
  private writeTimestamps: number[] = [];

  // Audit trail
  private _auditLog: AuditEntry[] = [];

  constructor(limits: Partial<PolicyLimits> = {}) {
    this.limits = { ...DEFAULT_POLICY_LIMITS, ...limits };
  }

  /**
   * Check whether an operation is allowed under current policy.
   * Records the decision in the audit trail.
   *
   * @throws {GuardError} if the operation exceeds policy limits
   */
  checkPolicy(operation: OperationType, target: string, meta?: { bytesWritten?: number }): void {
    const now = Date.now();

    // Rate limit checks for commands
    if (operation === "command" || operation === "git") {
      this.pruneWindow(this.commandTimestamps, now);

      if (this.limits.maxCommandsPerMinute > 0 &&
          this.commandTimestamps.length >= this.limits.maxCommandsPerMinute) {
        this.recordAudit(now, operation, "deny", target,
          `Rate limit exceeded: ${this.commandTimestamps.length} commands in the last ${this.limits.rateLimitWindowMs / 1000}s (limit: ${this.limits.maxCommandsPerMinute})`);
        throw new GuardError(
          `Rate limit exceeded: ${this.limits.maxCommandsPerMinute} commands per ${this.limits.rateLimitWindowMs / 1000}s`,
        );
      }

      // Cumulative command limit
      if (this.limits.maxTotalCommands > 0 && this._commandsRun >= this.limits.maxTotalCommands) {
        this.recordAudit(now, operation, "deny", target,
          `Session command limit exceeded: ${this._commandsRun} (limit: ${this.limits.maxTotalCommands})`);
        throw new GuardError(
          `Session limit exceeded: ${this.limits.maxTotalCommands} total commands`,
        );
      }

      this.commandTimestamps.push(now);
      this._commandsRun++;
    }

    // Rate limit checks for writes
    if (operation === "file_write") {
      this.pruneWindow(this.writeTimestamps, now);

      if (this.limits.maxWritesPerMinute > 0 &&
          this.writeTimestamps.length >= this.limits.maxWritesPerMinute) {
        this.recordAudit(now, operation, "deny", target,
          `Rate limit exceeded: ${this.writeTimestamps.length} writes in the last ${this.limits.rateLimitWindowMs / 1000}s (limit: ${this.limits.maxWritesPerMinute})`);
        throw new GuardError(
          `Rate limit exceeded: ${this.limits.maxWritesPerMinute} file writes per ${this.limits.rateLimitWindowMs / 1000}s`,
        );
      }

      this.writeTimestamps.push(now);
      this._filesWritten++;
    }

    // Cumulative bytes written check
    if (meta?.bytesWritten !== undefined) {
      const projected = this._bytesWritten + meta.bytesWritten;
      if (this.limits.maxTotalBytesWritten > 0 && projected > this.limits.maxTotalBytesWritten) {
        this.recordAudit(now, operation, "deny", target,
          `Session byte limit exceeded: ${projected} bytes (limit: ${this.limits.maxTotalBytesWritten})`);
        throw new GuardError(
          `Session limit exceeded: ${this.limits.maxTotalBytesWritten} total bytes written`,
        );
      }
      this._bytesWritten += meta.bytesWritten;
    }

    // Track reads
    if (operation === "file_read") {
      this._filesRead++;
    }

    this._operationsTotal++;

    // Record allowed
    this.recordAudit(now, operation, "allow", target);
  }

  /**
   * Get current session counters snapshot.
   */
  get counters(): SessionCounters {
    return {
      commandsRun: this._commandsRun,
      bytesWritten: this._bytesWritten,
      filesRead: this._filesRead,
      filesWritten: this._filesWritten,
      operationsTotal: this._operationsTotal,
    };
  }

  /**
   * Get the full audit trail.
   */
  get auditLog(): ReadonlyArray<AuditEntry> {
    return this._auditLog;
  }

  /**
   * Get a summary of the audit trail for logging.
   */
  auditSummary(): { total: number; allowed: number; denied: number; denials: AuditEntry[] } {
    const denied = this._auditLog.filter(e => e.verdict === "deny");
    return {
      total: this._auditLog.length,
      allowed: this._auditLog.length - denied.length,
      denied: denied.length,
      denials: denied,
    };
  }

  /**
   * The audit summary and counters in the shape a run record persists
   * (`RunRecord.guardAudit`). Denials keep only the most recent `maxDenials`,
   * without the per-entry counter snapshots, so a run that was denied
   * thousands of times does not bloat its record; `denialsDropped` says how
   * many were left out.
   */
  runAudit(maxDenials = 50): {
    total: number;
    allowed: number;
    denied: number;
    denials: Array<{ timestamp: number; operation: OperationType; target: string; reason?: string }>;
    denialsDropped?: number;
    counters: SessionCounters;
  } {
    const summary = this.auditSummary();
    const kept = maxDenials > 0 ? summary.denials.slice(-maxDenials) : [];
    const dropped = summary.denials.length - kept.length;
    return {
      total: summary.total,
      allowed: summary.allowed,
      denied: summary.denied,
      denials: kept.map(({ timestamp, operation, target, reason }) => ({
        timestamp,
        operation,
        target,
        ...(reason !== undefined ? { reason } : {}),
      })),
      ...(dropped > 0 ? { denialsDropped: dropped } : {}),
      counters: this.counters,
    };
  }

  // -- Internal helpers --

  private pruneWindow(timestamps: number[], now: number): void {
    const cutoff = now - this.limits.rateLimitWindowMs;
    // Remove timestamps older than the window.
    // Timestamps are in order, so find the first that's within window.
    let i = 0;
    while (i < timestamps.length && timestamps[i] < cutoff) {
      i++;
    }
    if (i > 0) {
      timestamps.splice(0, i);
    }
  }

  private recordAudit(
    timestamp: number,
    operation: OperationType,
    verdict: AuditVerdict,
    target: string,
    reason?: string,
  ): void {
    this._auditLog.push({
      timestamp,
      operation,
      verdict,
      target,
      reason,
      counters: { ...this.counters },
    });
  }
}
