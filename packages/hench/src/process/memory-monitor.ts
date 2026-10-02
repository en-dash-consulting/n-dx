/**
 * Cross-platform system memory monitoring for pre-spawn checks.
 *
 * Reads available memory through the shared llm-client reading
 * (`readAvailableMemory()`), the one the dashboard and hub admission also use,
 * so hench never disagrees with them about how much memory is left.
 *
 * Key differences from {@link MemoryThrottle}:
 * - **MemoryThrottle** is the entry-gate decision engine (delay/reject at run start)
 * - **SystemMemoryMonitor** is the lightweight pre-spawn check for the tool
 *   dispatch path
 *
 * Integration points:
 * - Standalone `checkBeforeSpawn()` for per-tool-call memory gating
 * - `snapshot()` for API/dashboard exposure and run memory stats
 *
 * Platform behavior (decided in llm-client `system-memory.ts`):
 * - **Linux**: `os.freemem()`, which is `MemAvailable` (libuv ≥ 1.45)
 * - **macOS**: free + inactive + speculative + purgeable pages from `vm_stat`,
 *   cached for 5 s so tool calls do not each spawn `vm_stat`. When it cannot be
 *   read the reading is unknown — never `os.freemem()`, which counts only
 *   Darwin's free pages (115 MB on a healthy 16 GB Mac).
 * - **Windows**: `os.freemem()` (Win32 `GlobalMemoryStatusEx`)
 *
 * An unknown reading (`availableBytes: null`) never blocks a spawn.
 *
 * ## Windows uses os.freemem() BY DECISION, not for want of a better reader
 *
 * The concern was that `ullAvailPhys` (what `os.freemem()` returns) counts only
 * free physical memory and excludes the standby list Windows reclaims on demand —
 * which would make Windows report less available memory than Linux's MemAvailable
 * for identical conditions, and so throttle hench's work sooner. Measured, and that
 * is not what happens.
 *
 * MEASUREMENT (31.5 GiB Windows 11 box, 2026-08-19), comparing `os.freemem()`
 * against `\Memory\Available MBytes` — the standby-INCLUSIVE counter, and the
 * closest analogue to MemAvailable:
 *
 * - Quiet system, 8 rounds reading counter → freemem → counter so that drift
 *   between the two counter reads bounds the noise: mean gap −26 MB, sign
 *   consistently NEGATIVE, mean drift 7 MB. That is −0.08 percentage points of
 *   total memory, in the OPPOSITE direction to the concern: `os.freemem()` reports
 *   slightly MORE available, not less.
 * - Under load, allocating 1 GiB at a time up to 14 GiB: typical gap 0.2–0.9 pp.
 *   One sample showed 2.60 pp and straddled the 90% spawn threshold, but that was
 *   sampling skew — `Get-Counter` costs about a second, and a gibibyte was being
 *   allocated between the two reads. The very next sample agreed, and the most
 *   loaded sample had a negative gap.
 *
 * The explanation is that `ullAvailPhys` is documented as memory available
 * "without having to write anything to disk", which already includes standby
 * pages: they are clean and can be repurposed immediately. So on Windows
 * `os.freemem()` IS the standby-inclusive figure, and no separate reader is needed.
 *
 * DO NOT "improve" THIS WITH A POWERSHELL OR WMI QUERY. `checkBeforeSpawn()` runs
 * on every process-spawning tool call (see tools/dispatch.ts), so any reader that
 * spawns a process would add a child process per tool call to buy a correction of
 * under a tenth of a percentage point. `wmic` is also deprecated and absent from
 * newer Windows images. If a future machine class does show a decision-moving gap,
 * the shared reader in llm-client's `system-memory.ts` (which already caches the
 * darwin reading) is where it would go — but bring the measurement first.
 *
 * @module hench/process/memory-monitor
 */

import { freemem, platform } from "node:os";
import { createAvailableMemoryReader, readAvailableMemory } from "../prd/llm-gateway.js";
import type { AvailableMemoryReading } from "../prd/llm-gateway.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default memory usage percentage that blocks process spawning. */
const DEFAULT_SPAWN_THRESHOLD = 90;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the system memory monitor.
 */
export interface MemoryMonitorConfig {
  /** Enable pre-spawn memory checks. When false, all checks are bypassed. */
  enabled: boolean;
  /** Memory usage percentage above which spawning is blocked (0–100). */
  spawnThreshold: number;
}

/** Default memory monitor configuration. */
export const DEFAULT_MEMORY_MONITOR_CONFIG: MemoryMonitorConfig = {
  enabled: true,
  spawnThreshold: DEFAULT_SPAWN_THRESHOLD,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Detailed cross-platform memory snapshot.
 * Suitable for JSON serialization and API/dashboard exposure.
 */
export interface SystemMemorySnapshot {
  /** Operating system platform. */
  platform: NodeJS.Platform;
  /** Total system memory in bytes. */
  totalBytes: number;
  /** Free memory in bytes (OS-reported, does not account for cache). */
  freeBytes: number;
  /**
   * Available memory in bytes, from the shared reading: `MemAvailable` on
   * Linux, reclaimable pages from `vm_stat` on macOS, `os.freemem()` on
   * Windows. `null` when the reading is unknown.
   */
  availableBytes: number | null;
  /** Memory usage as a percentage (0–100), based on available memory. `null` when unknown. */
  usagePercent: number | null;
  /** Total memory in MB. */
  totalMB: number;
  /** Free memory in MB. */
  freeMB: number;
  /** Available memory in MB. `null` when unknown. */
  availableMB: number | null;
  /** ISO timestamp of this snapshot. */
  timestamp: string;
}

/**
 * Result of a pre-spawn memory check.
 */
export interface SpawnMemoryCheck {
  /** Whether spawning is allowed. */
  allowed: boolean;
  /** Current memory usage percentage. `null` when the reading is unknown. */
  usagePercent: number | null;
  /** Configured spawn threshold. */
  spawnThreshold: number;
  /** Available memory in MB. `null` when the reading is unknown. */
  availableMB: number | null;
  /** Total memory in MB. */
  totalMB: number;
  /** Human-readable reason when blocked. Undefined when allowed. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Injectable overrides (for testing)
// ---------------------------------------------------------------------------

/**
 * Optional overrides for deterministic testing.
 *
 * `readAvailable` replaces the shared reading outright. Without it, overriding
 * `platform`, `freemem` or `totalmem` builds a private shared-module reader over
 * those values (so the platform decision still lives in llm-client); with no
 * overrides at all the process-wide cached reading is used.
 */
export interface MemoryMonitorOverrides {
  /** Override detected platform. */
  platform?: NodeJS.Platform;
  /** Override `os.freemem()`. */
  freemem?: () => number;
  /** Override `os.totalmem()`. */
  totalmem?: () => number;
  /** Override the available-memory reading. */
  readAvailable?: () => Promise<AvailableMemoryReading>;
}

function resolveReader(overrides: MemoryMonitorOverrides | undefined): () => Promise<AvailableMemoryReading> {
  if (overrides?.readAvailable) return overrides.readAvailable;
  if (overrides?.platform === undefined && overrides?.freemem === undefined && overrides?.totalmem === undefined) {
    return readAvailableMemory;
  }
  const reader = createAvailableMemoryReader({
    ...(overrides.platform !== undefined && { platform: overrides.platform }),
    ...(overrides.freemem !== undefined && { freemem: overrides.freemem }),
    ...(overrides.totalmem !== undefined && { totalmem: overrides.totalmem }),
  });
  return () => reader.read();
}

// ---------------------------------------------------------------------------
// SystemMemoryMonitor
// ---------------------------------------------------------------------------

/**
 * Cross-platform system memory monitor.
 *
 * Provides memory readings and a pre-spawn check that can be called before
 * every child process creation in the tool dispatch path. Readings come from
 * the shared llm-client reading, as do {@link MemoryThrottle}'s, so the
 * entry-gate and per-spawn checks agree.
 *
 * @example
 * ```ts
 * const monitor = new SystemMemoryMonitor({ spawnThreshold: 85 });
 *
 * // Quick pre-spawn check
 * const check = await monitor.checkBeforeSpawn();
 * if (!check.allowed) {
 *   console.warn(`Spawn blocked: ${check.reason}`);
 * }
 *
 * // Full snapshot for dashboard/API
 * const snap = await monitor.snapshot();
 * console.log(`Memory: ${snap.usagePercent ?? "unknown"}% used`);
 * ```
 */
export class SystemMemoryMonitor {
  private readonly _config: MemoryMonitorConfig;
  private readonly _platform: NodeJS.Platform;
  private readonly _freemem: () => number;
  private readonly _readAvailable: () => Promise<AvailableMemoryReading>;

  constructor(
    config?: Partial<MemoryMonitorConfig>,
    overrides?: MemoryMonitorOverrides,
  ) {
    this._config = { ...DEFAULT_MEMORY_MONITOR_CONFIG, ...config };
    this._platform = overrides?.platform ?? platform();
    this._freemem = overrides?.freemem ?? freemem;
    this._readAvailable = resolveReader(overrides);

    // Validate threshold
    if (this._config.spawnThreshold < 0 || this._config.spawnThreshold > 100) {
      throw new RangeError("SystemMemoryMonitor spawnThreshold must be between 0 and 100");
    }
  }

  /** Current configuration (read-only copy). */
  get config(): Readonly<MemoryMonitorConfig> {
    return { ...this._config };
  }

  /** Detected platform. */
  get detectedPlatform(): NodeJS.Platform {
    return this._platform;
  }

  // -----------------------------------------------------------------------
  // Snapshot
  // -----------------------------------------------------------------------

  /**
   * Take a detailed cross-platform memory snapshot from the shared reading.
   *
   * `availableBytes`, `availableMB` and `usagePercent` are `null` when the
   * reading is unknown (macOS with `vm_stat` unreadable). `freeBytes` is always
   * raw `os.freemem()` and is never substituted for an unknown availability.
   */
  async snapshot(): Promise<SystemMemorySnapshot> {
    const reading = await this._readAvailable();
    const { availableBytes, totalBytes } = reading;
    const freeBytes = this._freemem();

    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
    let usagePercent: number | null = null;
    if (availableBytes !== null) {
      usagePercent = totalBytes > 0
        ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10000) / 100
        : 0;
    }

    return {
      platform: this._platform,
      totalBytes,
      freeBytes,
      availableBytes,
      usagePercent,
      totalMB: toMB(totalBytes),
      freeMB: toMB(freeBytes),
      availableMB: availableBytes === null ? null : toMB(availableBytes),
      timestamp: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Pre-spawn check
  // -----------------------------------------------------------------------

  /**
   * Check whether system memory allows spawning a new child process.
   *
   * This is the primary integration point for the tool dispatch path.
   * Called before every process-spawning tool (`run_command`, `git`)
   * to prevent system-wide memory pressure.
   *
   * When disabled (via config), or when the reading is unknown, always returns
   * `{ allowed: true }` — an unknown reading is no memory signal, not a low one.
   *
   * @returns Structured result with the decision and current memory state.
   */
  async checkBeforeSpawn(): Promise<SpawnMemoryCheck> {
    const snap = await this.snapshot();
    const base = {
      usagePercent: snap.usagePercent,
      spawnThreshold: this._config.spawnThreshold,
      availableMB: snap.availableMB,
      totalMB: snap.totalMB,
    };

    if (!this._config.enabled || snap.usagePercent === null || snap.availableMB === null) {
      return { allowed: true, ...base };
    }

    const allowed = snap.usagePercent < this._config.spawnThreshold;

    return {
      allowed,
      ...base,
      reason: allowed
        ? undefined
        : `System memory usage (${snap.usagePercent.toFixed(1)}%) exceeds spawn threshold ` +
          `(${this._config.spawnThreshold}%). ` +
          `Available: ${snap.availableMB.toFixed(0)}MB / ${snap.totalMB.toFixed(0)}MB total. ` +
          `Close other applications to free memory, or adjust the threshold with: ` +
          `hench config guard.memoryMonitor.spawnThreshold <number>`,
    };
  }
}
