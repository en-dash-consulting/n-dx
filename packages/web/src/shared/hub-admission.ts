/**
 * The hub's machine-wide admission state, as it travels to a project server.
 *
 * The hub's proxy sets {@link HUB_ADMISSION_HEADER} on the requests it
 * forwards to `GET /api/live` and `GET /api/hench/prep/:taskId`, the way it
 * sets `X-Forwarded-Prefix`: the project server never imports hub code and has
 * no other way to learn what the machine is running. A request that did not
 * come through the hub carries no header, and the project server reports its
 * own repository's count.
 *
 * The proxy drops any copy of the header a client sent, so behind the hub the
 * value is always the hub's.
 *
 * @module web/shared/hub-admission
 */

/** Request header carrying {@link HubAdmissionHeader} as JSON. */
export const HUB_ADMISSION_HEADER = "x-ndx-hub-admission";

/** Kernel memory pressure as the shared available-memory reading names it. */
export type HubMemoryPressure = "normal" | "warn" | "critical" | "unknown";

const MEMORY_PRESSURES: readonly string[] = ["normal", "warn", "critical", "unknown"];

/** What the hub's admission gate measured: the machine's sessions, its cap, its queue and its memory. */
export interface HubAdmissionHeader {
  /** Dashboard-started runs in flight across every registered project. */
  running: number;
  maxSessions: number;
  /** Execute requests queued across every project. */
  queued: number;
  /** Available bytes the gate admitted against; `null` when the machine could not be read. Absent from older hubs. */
  availableBytes?: number | null;
  /** Absent from older hubs. */
  pressure?: HubMemoryPressure;
  /** The gate is holding runs back for memory rather than for the session cap. Absent from older hubs. */
  memoryPaused?: boolean;
}

export function formatHubAdmissionHeader(admission: HubAdmissionHeader): string {
  return JSON.stringify({
    running: admission.running,
    maxSessions: admission.maxSessions,
    queued: admission.queued,
    ...(admission.availableBytes !== undefined ? { availableBytes: admission.availableBytes } : {}),
    ...(admission.pressure !== undefined ? { pressure: admission.pressure } : {}),
    ...(admission.memoryPaused !== undefined ? { memoryPaused: admission.memoryPaused } : {}),
  });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The header's value, or null when absent or malformed. The memory fields are
 * optional: a malformed one is left out rather than discarding the counts.
 */
export function parseHubAdmissionHeader(value: string | string[] | undefined): HubAdmissionHeader | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { running, maxSessions, queued, availableBytes, pressure, memoryPaused } = parsed as Record<string, unknown>;
  if (!isCount(running) || !isCount(maxSessions) || !isCount(queued)) return null;
  return {
    running,
    maxSessions,
    queued,
    ...(availableBytes === null || (typeof availableBytes === "number" && availableBytes >= 0) ? { availableBytes } : {}),
    ...(typeof pressure === "string" && MEMORY_PRESSURES.includes(pressure) ? { pressure: pressure as HubMemoryPressure } : {}),
    ...(typeof memoryPaused === "boolean" ? { memoryPaused } : {}),
  };
}
