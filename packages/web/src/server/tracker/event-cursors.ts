/**
 * Where each tracker event source has read up to, so an event is queued once:
 * `<henchDir>/sidecar/tracker-cursors.json`, beside the activity log, machine
 * local and ignored by git. A restarted server reads it back and does not
 * queue again what it queued before.
 *
 * A source with no cursor has never been read. Its first read takes a
 * baseline and queues nothing: an event is something that happened since the
 * last tick, and before the first there was none, so turning a rule on never
 * replays a project's history into the tracker.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSidecarDir } from "../sidecar/sidecar-dir.js";
import { worktreeSidecarDir } from "../sidecar/session-registry.js";

/**
 * A high-water mark: the newest time read (ms since the epoch) and the keys
 * read at exactly that time, so two observations sharing a timestamp are
 * told apart. A baseline over nothing is `{ at: 0, keys: [] }`.
 */
export interface Watermark {
  at: number;
  keys: string[];
}

/** One source's cursor: a high-water mark, or the keys it has seen (`seen`). */
export type EventCursor = Watermark | { seen: string[] };

export type EventCursors = Record<string, EventCursor>;

/** Something a source observed: its key and when it happened. */
export interface Observation {
  key: string;
  /** ms since the epoch. */
  at: number;
}

const CURSORS_FILE = "tracker-cursors.json";

/** Where `projectDir`'s cursors live. */
export function trackerCursorsPath(projectDir: string): string {
  return join(worktreeSidecarDir(projectDir), CURSORS_FILE);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

function parseCursor(value: unknown): EventCursor | null {
  if (!isRecord(value)) return null;
  if (typeof value.at === "number" && Number.isFinite(value.at) && isStrings(value.keys)) return { at: value.at, keys: value.keys };
  if (isStrings(value.seen)) return { seen: value.seen };
  return null;
}

/**
 * The cursors saved for `projectDir`. A file that does not parse, or an
 * entry of the wrong shape, reads as no cursor: that source takes a fresh
 * baseline rather than replaying what it cannot tell it already queued.
 */
export function readEventCursors(projectDir: string): EventCursors {
  const path = trackerCursorsPath(projectDir);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
  const sources = isRecord(raw) && isRecord(raw.sources) ? raw.sources : {};
  const cursors: EventCursors = {};
  for (const [source, value] of Object.entries(sources)) {
    const cursor = parseCursor(value);
    if (cursor) cursors[source] = cursor;
  }
  return cursors;
}

/** Save `cursors` whole; written beside and renamed over, so a crash leaves the old file or the new. */
export function writeEventCursors(projectDir: string, cursors: EventCursors): void {
  const dir = worktreeSidecarDir(projectDir);
  ensureSidecarDir(dir);
  const path = join(dir, CURSORS_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, sources: cursors }, null, 2) + "\n", "utf-8");
  renameSync(temp, path);
}

/** The high-water mark over `observed`, starting from `from`. */
function highWater(from: Watermark, observed: readonly Observation[]): Watermark {
  let { at } = from;
  for (const o of observed) at = Math.max(at, o.at);
  const keys = new Set(at === from.at ? from.keys : []);
  for (const o of observed) if (o.at === at) keys.add(o.key);
  return { at, keys: [...keys].sort() };
}

/**
 * What in `observed` is newer than `cursor`, and the cursor after it. With no
 * cursor (or one of the other kind) nothing is new: the mark is the baseline.
 */
export function sinceWatermark<T extends Observation>(
  observed: readonly T[],
  cursor: EventCursor | undefined,
): { fresh: T[]; next: Watermark } {
  if (!cursor || !("at" in cursor)) return { fresh: [], next: highWater({ at: 0, keys: [] }, observed) };
  const known = new Set(cursor.keys);
  const fresh = observed.filter((o) => o.at > cursor.at || (o.at === cursor.at && !known.has(o.key)));
  return { fresh, next: highWater(cursor, observed) };
}

/**
 * The keys in `observed` not seen before, and the cursor after them. With no
 * cursor every key present is the baseline. Keys no longer observed are kept,
 * so one that comes back is not new.
 */
export function sinceSeen(observed: readonly string[], cursor: EventCursor | undefined): { fresh: string[]; next: { seen: string[] } } {
  const unique = [...new Set(observed)];
  if (!cursor || !("seen" in cursor)) return { fresh: [], next: { seen: unique.sort() } };
  const seen = new Set(cursor.seen);
  const fresh = unique.filter((key) => !seen.has(key));
  return { fresh, next: { seen: [...seen, ...fresh].sort() } };
}
