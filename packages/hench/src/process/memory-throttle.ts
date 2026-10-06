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
 * By default memory is read through the shared llm-client reading — the one
 * the dashboard and hub use — not `os.freemem()`, which on macOS counts only
 * free pages (115 MB on a healthy 16 GB Mac). An unknown reading decides
 * "allow" regardless of thresholds.
 *
 * @module hench/process/memory-throttle
 */

import { getAvailableMemory, readAvailableMemory } from "../prd/llm-gateway.js";
import type { AvailableMemoryReading } from "../prd/llm-gateway.js";

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
  enabled: false,
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
  /** Current system memory usage as a percentage (0–100). `null` when the reading is unknown. */
  memoryUsagePercent: number | null;
  /** Available system memory in MB. `null` when the reading is unknown. */
  freeMemoryMB: number | null;
  /** Total system memory in MB. */
  totalMemoryMB: number;
  /** Throttle decision based on current memory state ("allow" when unknown). */
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
 * Interface for reading system memory, injected via constructor for
 * deterministic testing. Without one, the throttle uses the shared
 * available-memory reading (`readAvailableMemory()` / `getAvailableMemory()`).
 */
export interface SystemMemoryReader {
  /** Available system memory in bytes. */
  freemem(): number;
  /** Total system memory in bytes. */
  totalmem(): number;
}

/** A memory sample: usage and available MB are both known, or both `null`. */
type MemorySample =
  | { usagePercent: number; freeMB: number; totalMB: number }
  | { usagePercent: null; freeMB: null; totalMB: number };

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function sampleFrom(availableBytes: number | null, totalBytes: number): MemorySample {
  if (availableBytes === null) return { usagePercent: null, freeMB: null, totalMB: toMB(totalBytes) };
  const usagePercent = totalBytes > 0
    ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10000) / 100
    : 0;
  return { usagePercent, freeMB: toMB(availableBytes), totalMB: toMB(totalBytes) };
}

function sampleFromReading(reading: AvailableMemoryReading): MemorySample {
  return sampleFrom(reading.availableBytes, reading.totalBytes);
}

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
  private readonly _memReader: SystemMemoryReader | undefined;

  constructor(
    config?: Partial<MemoryThrottleConfig>,
    memReader?: SystemMemoryReader,
  ) {
    this._config = { ...DEFAULT_MEMORY_THROTTLE_CONFIG, ...config };
    this._memReader = memReader;

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

  /** Sample from the injected reader, if any. */
  private _readInjected(): MemorySample | undefined {
    const reader = this._memReader;
    return reader ? sampleFrom(reader.freemem(), reader.totalmem()) : undefined;
  }

  /** Read current memory, awaiting a fresh-enough shared reading. */
  private async _readMemory(): Promise<MemorySample> {
    return this._readInjected() ?? sampleFromReading(await readAvailableMemory());
  }

  /** Read current memory without awaiting: the cached shared reading. */
  private _readMemoryNow(): MemorySample {
    return this._readInjected() ?? sampleFromReading(getAvailableMemory());
  }

  /**
   * Determine the throttle decision based on current memory.
   * An unknown reading is no memory signal, so it always allows.
   */
  private _decide(usagePercent: number | null): ThrottleDecision {
    if (!this._config.enabled || usagePercent === null) return "allow";
    if (usagePercent >= this._config.rejectThreshold) return "reject";
    if (usagePercent >= this._config.delayThreshold) return "delay";
    return "allow";
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /**
   * Get a point-in-time snapshot of memory state and throttle decision.
   *
   * Synchronous, so it reads the cached shared reading (`getAvailableMemory()`),
   * which never awaits a spawn; before the first macOS reading completes it is
   * unknown and the decision is "allow".
   */
  status(): MemoryThrottleStatus {
    const { usagePercent, freeMB, totalMB } = this._readMemoryNow();
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
    /** `null` only on an "allow" after a delay, when the reading became unknown. */
    memoryUsagePercent: number | null;
    delayMs?: number;
    attempt: number;
    maxRetries: number;
  }) => void): Promise<void> {
    return this._gateInternal(onThrottle);
  }

  private async _gateInternal(onThrottle?: (info: {
    decision: ThrottleDecision;
    memoryUsagePercent: number | null;
    delayMs?: number;
    attempt: number;
    maxRetries: number;
  }) => void): Promise<void> {
    if (!this._config.enabled) return;

    for (let attempt = 0; attempt <= this._config.maxRetries; attempt++) {
      const sample = await this._readMemory();
      const decision = this._decide(sample.usagePercent);

      if (decision === "allow" || sample.usagePercent === null) {
        // First attempt is immediate — no notification needed.
        // On subsequent attempts (after delays), notify that we're proceeding.
        if (attempt > 0) {
          onThrottle?.({
            decision: "allow",
            memoryUsagePercent: sample.usagePercent,
            attempt,
            maxRetries: this._config.maxRetries,
          });
        }
        return;
      }

      const { usagePercent, freeMB, totalMB } = sample;
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
    const final = await this._readMemory();
    if (final.usagePercent === null || this._decide(final.usagePercent) === "allow") return;

    // Still throttled after max retries — reject
    throw new MemoryThrottleRejectError(
      final.usagePercent,
      this._config.delayThreshold, // report against delay threshold since we timed out waiting
      final.freeMB,
      final.totalMB,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
