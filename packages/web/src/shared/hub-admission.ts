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

/**
 * How many queued entries the header carries.
 *
 * The header travels on every `GET /api/live`, and Node refuses a request
 * whose headers exceed 16 KB outright — a limit a long enough queue would
 * reach, taking the whole Live request with it rather than just the list. Ten
 * entries is a few hundred bytes and more than any queue strip shows at once;
 * {@link HubAdmissionHeader.queued} still counts them all, so a viewer showing
 * "3 of 40 waiting" stays truthful past the cut.
 */
export const MAX_HEADER_QUEUE_ENTRIES = 10;

/** Kernel memory pressure as the shared available-memory reading names it. */
export type HubMemoryPressure = "normal" | "warn" | "critical" | "unknown";

const MEMORY_PRESSURES: readonly string[] = ["normal", "warn", "critical", "unknown"];

/**
 * One execute request the hub has queued for the project being served.
 *
 * The identifying fields only. The gate's own entry also carries the run
 * options it will replay, which no Live reader needs and which would put a
 * project's operator prose on every request; `GET /api/hub/queue` is where
 * the full (redacted) entry lives.
 */
export interface HubQueuedRequest {
  taskId: string;
  /** Worktree key the request addressed, or null for the anchor. */
  workspace: string | null;
  enqueuedAt: string;
  /** How many tasks the request works through; absent means a single run. */
  mode?: string;
  /** Task count for `mode: "iterations"`. */
  iterations?: number;
}

/** What the hub's admission gate measured: the machine's sessions, its cap, its queue and its memory. */
export interface HubAdmissionHeader {
  /** Dashboard-started runs in flight across every registered project. */
  running: number;
  maxSessions: number;
  /** Execute requests queued across every project. */
  queued: number;
  /**
   * The queued requests for the project this request addressed, oldest first —
   * at most {@link MAX_HEADER_QUEUE_ENTRIES} of them. Absent from older hubs,
   * and empty when this project has nothing waiting even though others do,
   * which is why it is not derivable from {@link queued}.
   */
  queue?: HubQueuedRequest[];
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
    ...(admission.queue !== undefined
      ? { queue: admission.queue.slice(0, MAX_HEADER_QUEUE_ENTRIES).map(formatQueuedRequest) }
      : {}),
    ...(admission.availableBytes !== undefined ? { availableBytes: admission.availableBytes } : {}),
    ...(admission.pressure !== undefined ? { pressure: admission.pressure } : {}),
    ...(admission.memoryPaused !== undefined ? { memoryPaused: admission.memoryPaused } : {}),
  });
}

function formatQueuedRequest(entry: HubQueuedRequest): HubQueuedRequest {
  return {
    taskId: entry.taskId,
    workspace: entry.workspace,
    enqueuedAt: entry.enqueuedAt,
    ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
    ...(entry.iterations !== undefined ? { iterations: entry.iterations } : {}),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The queued entries in a parsed header, or undefined.
 *
 * An entry missing a task id or a timestamp is dropped rather than failing the
 * whole header: the counts beside it are still worth having, and a half-named
 * queue entry is nothing a viewer can act on. A `queue` that is not an array
 * at all is absent, the same as from a hub too old to send one.
 */
function parseQueue(value: unknown): HubQueuedRequest[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: HubQueuedRequest[] = [];
  for (const raw of value.slice(0, MAX_HEADER_QUEUE_ENTRIES)) {
    if (typeof raw !== "object" || raw === null) continue;
    const { taskId, workspace, enqueuedAt, mode, iterations } = raw as Record<string, unknown>;
    if (typeof taskId !== "string" || taskId.length === 0) continue;
    if (typeof enqueuedAt !== "string" || enqueuedAt.length === 0) continue;
    entries.push({
      taskId,
      workspace: typeof workspace === "string" ? workspace : null,
      enqueuedAt,
      ...(typeof mode === "string" ? { mode } : {}),
      ...(isCount(iterations) ? { iterations } : {}),
    });
  }
  return entries;
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
  const { running, maxSessions, queued, queue, availableBytes, pressure, memoryPaused } = parsed as Record<string, unknown>;
  if (!isCount(running) || !isCount(maxSessions) || !isCount(queued)) return null;
  const entries = parseQueue(queue);
  return {
    running,
    maxSessions,
    queued,
    ...(entries !== undefined ? { queue: entries } : {}),
    ...(availableBytes === null || (typeof availableBytes === "number" && availableBytes >= 0) ? { availableBytes } : {}),
    ...(typeof pressure === "string" && MEMORY_PRESSURES.includes(pressure) ? { pressure: pressure as HubMemoryPressure } : {}),
    ...(typeof memoryPaused === "boolean" ? { memoryPaused } : {}),
  };
}
