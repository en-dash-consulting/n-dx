/**
 * Memory-based execution throttling for hench.
 *
 * Monitors system memory usage and provides intelligent throttling
 * decisions to prevent system resource exhaustion during task execution.
 *
 * Two thresholds trigger different behaviors:
 * - **Delay threshold** (default 80%): new executions are delayed with
 *   exponential backoff until memory drops below the threshold.
 * - **Reject threshold** (default 95%): new executions are rejected
 *   outright to protect system stability.
 *
 * Works alongside {@link ProcessLimiter} — the limiter controls
 * concurrency via lock files, while the memory throttle adds a
 * resource-aware gate before the limiter is even consulted.
 *
 * @module hench/process/memory-throttle
 */

import { freemem, totalmem } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default memory usage percentage that triggers execution delays. */
const DEFAULT_DELAY_THRESHOLD = 80;

/** Default memory usage percentage that triggers execution rejection. */
const DEFAULT_REJECT_THRESHOLD = 95;

/** Base delay in ms when memory is above the delay threshold. */
const DEFAULT_BASE_DELAY_MS = 2000;

/** Maximum delay in ms for exponential backoff. */
const DEFAULT_MAX_DELAY_MS = 30000;

/** Maximum number of retry attempts before giving up when throttled. */
const DEFAULT_MAX_RETRIES = 10;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when system memory usage exceeds the rejection threshold.
 *
 * Contains metadata about the current memory state so the CLI can
 * display an actionable message.
 */
export class MemoryThrottleRejectError extends Error {
  /** Current system memory usage as a percentage (0–100). */
  readonly memoryUsagePercent: number;
  /** Configured rejection threshold percentage. */
  readonly rejectThreshold: number;
  /** Free system memory in MB. */
  readonly freeMemoryMB: number;
  /** Total system memory in MB. */
  readonly totalMemoryMB: number;

  constructor(
    memoryUsagePercent: number,
    rejectThreshold: number,
    freeMemoryMB: number,
    totalMemoryMB: number,
  ) {
    const msg =
      `System memory usage (${memoryUsagePercent.toFixed(1)}%) exceeds rejection threshold (${rejectThreshold}%). ` +
      `Free: ${freeMemoryMB.toFixed(0)}MB / ${totalMemoryMB.toFixed(0)}MB total. ` +
      `Close other applications to free memory, or adjust thresholds with: ` +
      `hench config guard.memoryThrottle.rejectThreshold <number>`;
    super(msg);
    this.name = "MemoryThrottleRejectError";
    this.memoryUsagePercent = memoryUsagePercent;
    this.rejectThreshold = rejectThreshold;
    this.freeMemoryMB = freeMemoryMB;
    this.totalMemoryMB = totalMemoryMB;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for memory-based execution throttling.
 */
export interface MemoryThrottleConfig {
  /** Enable memory throttling. When false, all checks are bypassed. */
  enabled: boolean;
  /** Memory usage percentage that triggers execution delays (0–100). */
  delayThreshold: number;
  /** Memory usage percentage that triggers execution rejection (0–100). */
  rejectThreshold: number;
  /** Base delay in ms when memory exceeds the delay threshold. */
  baseDelayMs: number;
  /** Maximum delay in ms for exponential backoff. */
  maxDelayMs: number;
  /** Maximum retry attempts before rejecting when throttled. */
  maxRetries: number;
}

/** Default memory throttle configuration. */
export const DEFAULT_MEMORY_THROTTLE_CONFIG: MemoryThrottleConfig = {
  enabled: true,
  delayThreshold: DEFAULT_DELAY_THRESHOLD,
  rejectThreshold: DEFAULT_REJECT_THRESHOLD,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
};

// ---------------------------------------------------------------------------
// Throttle status
// ---------------------------------------------------------------------------

/** Throttle decision: allow, delay, or reject. */
export type ThrottleDecision = "allow" | "delay" | "reject";

/**
 * Point-in-time snapshot of memory state and throttle decision.
 * Suitable for JSON serialization and API exposure.
 */
export interface MemoryThrottleStatus {
  /** Whether memory throttling is enabled. */
  enabled: boolean;
  /** Current system memory usage as a percentage (0–100). */
  memoryUsagePercent: number;
  /** Free system memory in MB. */
  freeMemoryMB: number;
  /** Total system memory in MB. */
  totalMemoryMB: number;
  /** Throttle decision based on current memory state. */
  decision: ThrottleDecision;
  /** Configured delay threshold percentage. */
  delayThreshold: number;
  /** Configured reject threshold percentage. */
  rejectThreshold: number;
  /** ISO timestamp of this snapshot. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// System memory reader (injectable for testing)
// ---------------------------------------------------------------------------

/**
 * Interface for reading system memory. Defaults to `os.freemem()`/`os.totalmem()`.
 * Injected via constructor for deterministic testing.
 */
export interface SystemMemoryReader {
  /** Free system memory in bytes. */
  freemem(): number;
  /** Total system memory in bytes. */
  totalmem(): number;
}

const DEFAULT_MEMORY_READER: SystemMemoryReader = {
  freemem,
  totalmem,
};

// ---------------------------------------------------------------------------
// MemoryThrottle
// ---------------------------------------------------------------------------

/**
 * Memory-based execution throttle.
 *
 * Checks system memory before allowing a new hench execution to proceed.
 * When memory is above the delay threshold, waits with exponential backoff.
 * When memory exceeds the reject threshold, throws immediately.
 *
 * @example
 * ```ts
 * const throttle = new MemoryThrottle(config.guard.memoryThrottle);
 *
 * // Check before starting a run
 * await throttle.gate(({ decision, memoryUsagePercent, delayMs }) => {
 *   console.log(`Memory: ${memoryUsagePercent}%, decision: ${decision}`);
 *   if (delayMs) console.log(`Delaying ${delayMs}ms...`);
 * });
 *
 * // Get status for API
 * const status = throttle.status();
 * ```
 */
export class MemoryThrottle {
  private readonly _config: MemoryThrottleConfig;
  private readonly _memReader: SystemMemoryReader;

  constructor(
    config?: Partial<MemoryThrottleConfig>,
    memReader?: SystemMemoryReader,
  ) {
    this._config = { ...DEFAULT_MEMORY_THROTTLE_CONFIG, ...config };
    this._memReader = memReader ?? DEFAULT_MEMORY_READER;

    // Validate thresholds
    if (this._config.delayThreshold < 0 || this._config.delayThreshold > 100) {
      throw new RangeError("MemoryThrottle delayThreshold must be between 0 and 100");
    }
    if (this._config.rejectThreshold < 0 || this._config.rejectThreshold > 100) {
      throw new RangeError("MemoryThrottle rejectThreshold must be between 0 and 100");
    }
    if (this._config.rejectThreshold <= this._config.delayThreshold) {
      throw new RangeError("MemoryThrottle rejectThreshold must be greater than delayThreshold");
    }
  }

  /** Current configuration (read-only copy). */
  get config(): Readonly<MemoryThrottleConfig> {
    return { ...this._config };
  }

  // -----------------------------------------------------------------------
  // Memory sampling
  // -----------------------------------------------------------------------

  /**
   * Read current system memory state.
   */
  private _readMemory(): { usagePercent: number; freeMB: number; totalMB: number } {
    const free = this._memReader.freemem();
    const total = this._memReader.totalmem();
    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

    const usagePercent = total > 0
      ? Math.round(((total - free) / total) * 10000) / 100
      : 0;

    return {
      usagePercent,
      freeMB: toMB(free),
      totalMB: toMB(total),
    };
  }

  /**
   * Determine the throttle decision based on current memory.
   */
  private _decide(usagePercent: number): ThrottleDecision {
    if (!this._config.enabled) return "allow";
    if (usagePercent >= this._config.rejectThreshold) return "reject";
    if (usagePercent >= this._config.delayThreshold) return "delay";
    return "allow";
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Get a point-in-time snapshot of memory state and throttle decision.
   */
  status(): MemoryThrottleStatus {
    const { usagePercent, freeMB, totalMB } = this._readMemory();
    return {
      enabled: this._config.enabled,
      memoryUsagePercent: usagePercent,
      freeMemoryMB: freeMB,
      totalMemoryMB: totalMB,
      decision: this._decide(usagePercent),
      delayThreshold: this._config.delayThreshold,
      rejectThreshold: this._config.rejectThreshold,
      timestamp: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Gate (blocking check)
  // -----------------------------------------------------------------------

  /**
   * Notification callback invoked during throttling delays.
   * Allows the caller to display progress messages.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  gate(onThrottle?: (info: {
    decision: ThrottleDecision;
    memoryUsagePercent: number;
    delayMs?: number;
    attempt: number;
    maxRetries: number;
  }) => void): Promise<void> {
    return this._gateInternal(onThrottle);
  }

  private async _gateInternal(onThrottle?: (info: {
    decision: ThrottleDecision;
    memoryUsagePercent: number;
    delayMs?: number;
    attempt: number;
    maxRetries: number;
  }) => void): Promise<void> {
    if (!this._config.enabled) return;

    for (let attempt = 0; attempt <= this._config.maxRetries; attempt++) {
      const { usagePercent, freeMB, totalMB } = this._readMemory();
      const decision = this._decide(usagePercent);

      if (decision === "allow") {
        // First attempt is immediate — no notification needed.
        // On subsequent attempts (after delays), notify that we're proceeding.
        if (attempt > 0) {
          onThrottle?.({
            decision,
            memoryUsagePercent: usagePercent,
            attempt,
            maxRetries: this._config.maxRetries,
          });
        }
        return;
      }

      if (decision === "reject") {
        onThrottle?.({
          decision,
          memoryUsagePercent: usagePercent,
          attempt,
          maxRetries: this._config.maxRetries,
        });
        throw new MemoryThrottleRejectError(
          usagePercent,
          this._config.rejectThreshold,
          freeMB,
          totalMB,
        );
      }

      // decision === "delay"
      const delayMs = Math.min(
        this._config.baseDelayMs * Math.pow(2, attempt),
        this._config.maxDelayMs,
      );

      onThrottle?.({
        decision,
        memoryUsagePercent: usagePercent,
        delayMs,
        attempt,
        maxRetries: this._config.maxRetries,
      });

      await sleep(delayMs);
    }

    // Exhausted all retries while in delay zone — check one final time
    const { usagePercent, freeMB, totalMB } = this._readMemory();
    const finalDecision = this._decide(usagePercent);

    if (finalDecision === "allow") return;

    // Still throttled after max retries — reject
    throw new MemoryThrottleRejectError(
      usagePercent,
      this._config.delayThreshold, // report against delay threshold since we timed out waiting
      freeMB,
      totalMB,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
