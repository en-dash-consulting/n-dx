/**
 * Shared "how much memory can this machine give me" reading.
 *
 * `os.freemem()` is not that number on macOS: it reports only Darwin's *free*
 * pages and leaves out inactive, speculative and purgeable memory the OS hands
 * back on demand. A healthy 16 GB Mac reads ~115 MB free while `vm_stat` shows
 * ~3.6 GB inactive. This module is the one place that knows the difference, so
 * every caller (hench throttle, dashboard, hub admission) agrees.
 *
 * - **darwin**: `vm_stat` (free + inactive + speculative + purgeable pages) for
 *   bytes, `kern.memorystatus_vm_pressure_level` for health. Run via `exec()`
 *   in parallel with a short timeout. A reading that cannot be taken is `null`
 *   bytes / `"unknown"` pressure — never 0 and never the `os.freemem()` value,
 *   so callers can refuse to act on it.
 * - **linux / win32**: `os.freemem()`, which is already MemAvailable (libuv ≥ 1.45)
 *   / `ullAvailPhys` (standby-inclusive). Unchanged; no process is spawned.
 *   See the docblock in hench's `process/memory-monitor.ts` for the Windows
 *   measurement.
 *
 * `getAvailableMemory()` is synchronous and never awaits a spawn: it returns the
 * cached reading and starts a background refresh. `readAvailableMemory()` awaits
 * a fresh-enough reading. Both share one in-flight refresh.
 *
 * @module llm-client/system-memory
 */

import { freemem, tmpdir, totalmem } from "node:os";
import { exec as execCommand } from "./exec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryPressure = "normal" | "warn" | "critical" | "unknown";

export interface AvailableMemoryReading {
  /** Bytes the OS can give a new workload without swapping, or `null` when unreadable. */
  availableBytes: number | null;
  /** Total physical memory in bytes. */
  totalBytes: number;
  /** Memory health. `"unknown"` when no signal could be read. */
  pressure: MemoryPressure;
  /** Where the reading came from, e.g. `"darwin:vm_stat+sysctl"`, `"os.freemem"`, `"pending"`. */
  source: string;
}

/** Runs a command and resolves to its stdout; rejects on failure or timeout. */
export type ExecRunner = (command: string, args: string[], timeoutMs: number) => Promise<string>;

/** Injection seam for tests. Every field defaults to the real thing. */
export interface SystemMemoryDeps {
  platform: NodeJS.Platform;
  exec: ExecRunner;
  freemem: () => number;
  totalmem: () => number;
  now: () => number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long a reading stays fresh. */
export const MEMORY_READING_TTL_MS = 5_000;

/** Per-command timeout for `vm_stat` / `sysctl`. */
export const MEMORY_EXEC_TIMEOUT_MS = 1_500;

/** Used-memory percentage at or above which pressure is `"critical"`. */
export const PRESSURE_CRITICAL_USED_PERCENT = 90;

/** Used-memory percentage at or above which pressure is `"warn"`. */
export const PRESSURE_WARN_USED_PERCENT = 75;

/** Returned by `getAvailableMemory()` before the first reading completes. */
const PENDING_SOURCE = "pending";

// ---------------------------------------------------------------------------
// Pure parsing / derivation (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse `vm_stat` output into available bytes:
 * (free + inactive + speculative + purgeable) × page size.
 *
 * Returns `null` when the page-size header or the `Pages free` line is missing
 * — never 0, so an unparseable reading cannot masquerade as "no memory left".
 * Other page classes absent from the output count as 0.
 */
export function parseVmStatAvailableBytes(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  if (pageSize === undefined) return null;

  const pages = (label: string): number | null => {
    const match = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.?\\s*$`, "m").exec(output);
    return match ? Number(match[1]) : null;
  };

  const free = pages("free");
  if (free === null) return null;

  const reclaimable = free + (pages("inactive") ?? 0) + (pages("speculative") ?? 0) + (pages("purgeable") ?? 0);
  return reclaimable * Number(pageSize);
}

/**
 * Map `kern.memorystatus_vm_pressure_level` output (1 / 2 / 4) to a pressure.
 * Anything else, including empty output, is `null` (treated as a failed read).
 */
export function parseDarwinPressureLevel(output: string): Exclude<MemoryPressure, "unknown"> | null {
  switch (output.trim()) {
    case "1": return "normal";
    case "2": return "warn";
    case "4": return "critical";
    default: return null;
  }
}

/** Derive pressure from used% = (total − available) / total. */
export function derivePressure(availableBytes: number, totalBytes: number): Exclude<MemoryPressure, "unknown"> {
  if (totalBytes <= 0) return "normal";
  const usedPercent = ((totalBytes - availableBytes) / totalBytes) * 100;
  if (usedPercent >= PRESSURE_CRITICAL_USED_PERCENT) return "critical";
  if (usedPercent >= PRESSURE_WARN_USED_PERCENT) return "warn";
  return "normal";
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export interface AvailableMemoryReader {
  /** Await a reading no older than the TTL. Never rejects. */
  read(): Promise<AvailableMemoryReading>;
  /** Cached reading now; starts a background refresh when stale. Never spawns synchronously. */
  get(): AvailableMemoryReading;
}

/** Default runner: llm-client `exec()` (the repo's sanctioned spawn path); any non-clean exit rejects. */
async function defaultExec(command: string, args: string[], timeoutMs: number): Promise<string> {
  const result = await execCommand(command, args, { cwd: tmpdir(), timeout: timeoutMs });
  if (!result.launched || result.error !== null || result.exitCode !== 0) {
    throw result.error ?? new Error(`${command} exited with ${result.exitCode}`);
  }
  return result.stdout;
}

/** Run a command; a failure is a missing signal (`null`), not an error. */
async function tryExec(exec: ExecRunner, command: string, args: string[]): Promise<string | null> {
  try {
    return await exec(command, args, MEMORY_EXEC_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/** Build a reader over the given dependencies. Each reader has its own cache. */
export function createAvailableMemoryReader(overrides: Partial<SystemMemoryDeps> = {}): AvailableMemoryReader {
  const deps: SystemMemoryDeps = {
    platform: process.platform,
    exec: defaultExec,
    freemem,
    totalmem,
    now: Date.now,
    ...overrides,
  };

  let cached: { reading: AvailableMemoryReading; at: number } | null = null;
  let inflight: Promise<AvailableMemoryReading> | null = null;

  const readOsFreemem = (): AvailableMemoryReading => {
    const availableBytes = deps.freemem();
    const totalBytes = deps.totalmem();
    return { availableBytes, totalBytes, pressure: derivePressure(availableBytes, totalBytes), source: "os.freemem" };
  };

  const readDarwin = async (): Promise<AvailableMemoryReading> => {
    const [vmStat, sysctl] = await Promise.all([
      tryExec(deps.exec, "vm_stat", []),
      tryExec(deps.exec, "sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
    ]);
    const totalBytes = deps.totalmem();
    const availableBytes = vmStat === null ? null : parseVmStatAvailableBytes(vmStat);
    const kernelPressure = sysctl === null ? null : parseDarwinPressureLevel(sysctl);

    let pressure: MemoryPressure = "unknown";
    if (kernelPressure !== null) pressure = kernelPressure;
    else if (availableBytes !== null) pressure = derivePressure(availableBytes, totalBytes);

    const sources = [
      ...(availableBytes !== null ? ["vm_stat"] : []),
      ...(kernelPressure !== null ? ["sysctl"] : []),
    ];
    return { availableBytes, totalBytes, pressure, source: `darwin:${sources.join("+") || "unavailable"}` };
  };

  const refresh = (): Promise<AvailableMemoryReading> => {
    inflight ??= readDarwin()
      .then((reading) => {
        cached = { reading, at: deps.now() };
        return reading;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const isFresh = (): boolean => cached !== null && deps.now() - cached.at < MEMORY_READING_TTL_MS;

  return {
    async read() {
      if (deps.platform !== "darwin") return readOsFreemem();
      if (cached !== null && isFresh()) return cached.reading;
      return refresh();
    },
    get() {
      // os.freemem() is a cheap syscall, not a spawn: no cache, no "pending".
      if (deps.platform !== "darwin") return readOsFreemem();
      if (!isFresh()) void refresh();
      return cached?.reading ?? {
        availableBytes: null,
        totalBytes: deps.totalmem(),
        pressure: "unknown",
        source: PENDING_SOURCE,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Process-wide default reader
// ---------------------------------------------------------------------------

const defaultReader = createAvailableMemoryReader();

/** Await the machine's available-memory reading (cached for 5 s). */
export function readAvailableMemory(): Promise<AvailableMemoryReading> {
  return defaultReader.read();
}

/**
 * The cached reading, synchronously. Starts a background refresh when stale and
 * never awaits a spawn; before the first darwin reading completes it returns
 * `{ availableBytes: null, pressure: "unknown", source: "pending" }`.
 */
export function getAvailableMemory(): AvailableMemoryReading {
  return defaultReader.get();
}
