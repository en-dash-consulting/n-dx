/**
 * The machine's memory as the dashboard reports it: the shared available-memory
 * reading turned into the `system` block and health level of
 * `GET /api/hench/memory`.
 *
 * Nothing here knows about runs or workspaces; `routes-hench.ts` adds the
 * per-process entries for the executions it tracks.
 *
 * @module web/server/memory-status
 */

import {
  getAvailableMemory,
  readAvailableMemory,
  type AvailableMemoryReading,
  type MemoryPressure,
} from "@n-dx/llm-client";

/**
 * Memory health level for UI indicators.
 *
 * `"unknown"` is not a degree of pressure — it means the machine could not be
 * read at all (macOS with `vm_stat` and `sysctl` both unavailable). Nothing may
 * warn, throttle or hold a run on it.
 */
export type MemoryHealthLevel = "healthy" | "warning" | "critical" | "unknown";

/** Per-process memory snapshot. */
export interface ProcessMemoryEntry {
  taskId: string;
  taskTitle: string;
  pid: number;
  rssBytes: number;
  source: "dashboard" | "disk";
}

/** Full memory status response shape. */
export interface MemoryStatus {
  system: {
    totalBytes: number;
    /**
     * The shared reading's `availableBytes`, under the name the API has always
     * used. Not `os.freemem()` on macOS — see `llm-client/system-memory.ts`.
     * `null` when the machine could not be read.
     */
    freeBytes: number | null;
    /** The same number as {@link freeBytes}, under the name the reading uses. */
    availableBytes: number | null;
    usedBytes: number | null;
    usedPercent: number | null;
    /** Kernel memory pressure, or `"unknown"` when nothing could be read. */
    pressure: MemoryPressure;
    /** Where the reading came from, e.g. `"darwin:vm_stat+sysctl"`, `"os.freemem"`. */
    source: string;
  };
  server: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  processes: ProcessMemoryEntry[];
  health: MemoryHealthLevel;
  loadAvg: [number, number, number];
  cpuCount: number;
  timestamp: string;
}

/**
 * Memory health from the shared reading's pressure.
 *
 * The thresholds themselves live in `llm-client/system-memory.ts` (75% / 90%
 * used, or macOS's `kern.memorystatus_vm_pressure_level` where it can be read),
 * so the dashboard, the hub gate and hench's throttle all flag at the same point.
 */
function healthFromPressure(pressure: MemoryPressure): MemoryHealthLevel {
  switch (pressure) {
    case "normal": return "healthy";
    case "warn": return "warning";
    case "critical": return "critical";
    case "unknown": return "unknown";
  }
}

/**
 * Where {@link readSystemMemory} gets its reading. Synchronous and cached —
 * a request must never wait on a `vm_stat` spawn.
 */
let readAvailable: () => AvailableMemoryReading = getAvailableMemory;

/**
 * Point the memory routes at a fixed reading, so a test can exercise a darwin
 * machine (or an unreadable one) on any platform. `null` restores the shared
 * reading. Nothing in production calls this.
 */
export function setAvailableMemoryReaderForTests(read: (() => AvailableMemoryReading) | null): void {
  readAvailable = read ?? getAvailableMemory;
}

/**
 * Derive the API's `system` block from an available-memory reading.
 *
 * `freeBytes` carries `availableBytes` — on macOS `os.freemem()` counts only
 * free pages and reads ~115 MB on a machine with ~3.9 GB it can hand out, which
 * is what used to make a healthy Mac read "critical" at 99% used.
 *
 * An unreadable machine is not a full one: `freeBytes`, `usedBytes` and
 * `usedPercent` are all `null` rather than 0, so no consumer can compute a
 * usage figure out of a reading that does not exist.
 */
export function systemMemoryFrom(
  reading: AvailableMemoryReading,
): MemoryStatus["system"] & { health: MemoryHealthLevel } {
  const { availableBytes, totalBytes, pressure, source } = reading;
  const known = availableBytes !== null;
  const usedBytes = known ? totalBytes - availableBytes : null;
  return {
    totalBytes,
    freeBytes: availableBytes,
    availableBytes,
    usedBytes,
    usedPercent: usedBytes !== null && totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : null,
    pressure,
    source,
    health: healthFromPressure(pressure),
  };
}

/**
 * The machine's memory and its health level — the `system` and `health`
 * parts of `GET /api/hench/memory`, without the per-process `ps` probes,
 * for readers that must answer quickly (the Live overview).
 */
export function readSystemMemory(): MemoryStatus["system"] & { health: MemoryHealthLevel } {
  return systemMemoryFrom(readAvailable());
}

/**
 * Take one reading so the cache is warm before the first request.
 *
 * `getAvailableMemory()` never spawns synchronously: until a darwin reading has
 * completed it answers `"pending"` with no bytes, which every consumer treats as
 * unknown. Warming at start-up means the first dashboard paint shows the machine
 * rather than a dash.
 */
export function warmSystemMemory(): void {
  void readAvailableMemory().catch(() => {});
}
