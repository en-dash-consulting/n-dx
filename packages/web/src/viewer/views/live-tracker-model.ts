/**
 * Reading `GET /api/tracker/activity` for Live's Tracker activity section:
 * the wire shapes, and the words each entry and connection state is shown in.
 * Plain functions over plain values; `live-tracker.ts` only lays them out.
 */

export type TrackerResult = "would" | "ok" | "duplicate" | "refused" | "card" | "dismissed" | "unavailable" | "needs-sign-in";

export interface TrackerProblem {
  field?: string;
  message: string;
}

export interface TrackerActivityRow {
  at: string;
  event: string;
  rexId: string;
  requestId: string;
  call: { tool: string; args: Record<string, unknown> };
  result: TrackerResult;
  problems?: TrackerProblem[];
}

export interface TrackerConnectionState {
  id: string;
  label: string;
  state: "connected" | "unavailable" | "needs-sign-in";
  reason?: string;
  signIn?: "first" | "again";
}

export interface TrackerActivity {
  entries: TrackerActivityRow[];
  /** Request ids of the cards still waiting for a decision. */
  cards: string[];
  connection: TrackerConnectionState;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The route's answer as {@link TrackerActivity}; null when no tracker connection is configured or the answer is not one. */
export function asTrackerActivity(body: unknown): TrackerActivity | null {
  if (!isRecord(body) || !Array.isArray(body.entries) || !isRecord(body.connection)) return null;
  const { connection } = body;
  if (typeof connection.id !== "string" || typeof connection.label !== "string" || typeof connection.state !== "string") return null;
  return {
    entries: body.entries.filter((e): e is TrackerActivityRow => isRecord(e) && typeof e.requestId === "string" && isRecord(e.call)),
    cards: Array.isArray(body.cards) ? body.cards.filter((c): c is string => typeof c === "string") : [],
    connection: connection as unknown as TrackerConnectionState,
  };
}

const RESULT_LABEL: Record<TrackerResult, string> = {
  would: "would call (dry run)",
  ok: "done",
  duplicate: "already there",
  refused: "refused",
  card: "needs a decision",
  dismissed: "dismissed",
  unavailable: "connection unavailable",
  "needs-sign-in": "sign in again",
};

/** The result as the list words it. */
export function resultLabel(result: TrackerResult): string {
  return RESULT_LABEL[result] ?? result;
}

/** "run-started" as "run started". */
export function eventLabel(event: string): string {
  return event.replace(/-/g, " ");
}

/** The entries newest first, each with whether its card is still waiting. */
export function activityRows(activity: TrackerActivity): Array<{ entry: TrackerActivityRow; waiting: boolean }> {
  const waiting = new Set(activity.cards);
  const rows: Array<{ entry: TrackerActivityRow; waiting: boolean }> = [];
  // A card is waiting on its latest card entry only; an earlier one is history.
  const seen = new Set<string>();
  for (let i = activity.entries.length - 1; i >= 0; i--) {
    const entry = activity.entries[i];
    const open = entry.result === "card" && waiting.has(entry.requestId) && !seen.has(entry.requestId);
    if (open) seen.add(entry.requestId);
    rows.push({ entry, waiting: open });
  }
  return rows;
}

/** The connection's state as Settings > Connections words it. */
export function trackerConnectionLabel(connection: TrackerConnectionState): string {
  if (connection.state === "connected") return "connected";
  if (connection.state === "unavailable") return `connection unavailable: ${connection.reason ?? "unknown reason"}`;
  return connection.signIn === "again" ? "sign in again" : "sign in";
}
