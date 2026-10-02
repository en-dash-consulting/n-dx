/**
 * The hub's machine-wide admission state, as it travels to a project server.
 *
 * The hub's proxy sets {@link HUB_ADMISSION_HEADER} on the requests it
 * forwards to `GET /api/live`, the way it sets `X-Forwarded-Prefix`: the
 * project server never imports hub code and has no other way to learn what
 * the machine is running. A request that did not come through the hub carries
 * no header, and the project server reports its own repository's count.
 *
 * The proxy drops any copy of the header a client sent, so behind the hub the
 * value is always the hub's.
 *
 * @module web/shared/hub-admission
 */

/** Request header carrying {@link HubAdmissionHeader} as JSON. */
export const HUB_ADMISSION_HEADER = "x-ndx-hub-admission";

/** What the hub's admission gate measured: the machine's sessions, its cap, and its queue. */
export interface HubAdmissionHeader {
  /** Dashboard-started runs in flight across every registered project. */
  running: number;
  maxSessions: number;
  /** Execute requests queued across every project. */
  queued: number;
}

export function formatHubAdmissionHeader(admission: HubAdmissionHeader): string {
  return JSON.stringify({ running: admission.running, maxSessions: admission.maxSessions, queued: admission.queued });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The header's value, or null when absent or malformed. */
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
  const { running, maxSessions, queued } = parsed as Record<string, unknown>;
  if (!isCount(running) || !isCount(maxSessions) || !isCount(queued)) return null;
  return { running, maxSessions, queued };
}
