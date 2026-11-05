/**
 * The tracker activity log: every planned or made tracker call, append-only
 * JSONL in the worktree's Sidecar directory (`<henchDir>/sidecar/`, machine
 * local and ignored by git), one writer (sync-engine.ts) and one reader
 * (`GET /api/tracker/activity`).
 *
 * `result` says what became of the call:
 * - `would`: a dry-run rule; nothing was called.
 * - `card`: a create or blocked rule; a person decides, nothing was called.
 * - `ok`: called and accepted (a create confirmed by a read).
 * - `duplicate`: the tracker had it already, confirmed by a read.
 * - `refused`: the tracker refused it; `problems` lists why. Never retried.
 * - `unavailable` / `needs-sign-in`: the connection could not be used; the
 *   event stays queued for the next tick, with the same arguments.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SidecarCallProblem } from "../../shared/index.js";
import { ensureSidecarDir } from "../sidecar/sidecar-dir.js";
import { worktreeSidecarDir } from "../sidecar/session-registry.js";
import type { TrackerEvent } from "./server-profiles.js";
import type { PlannedCall, TrackerRuleKind } from "./rules.js";
import type { TrackerRuleMode } from "./sync-config.js";

export const TRACKER_RESULTS = ["would", "ok", "duplicate", "refused", "card", "unavailable", "needs-sign-in"] as const;
export type TrackerResult = (typeof TRACKER_RESULTS)[number];

/** Results that settle an event: it is never planned again. */
export const SETTLED_RESULTS: ReadonlySet<TrackerResult> = new Set(["ok", "duplicate", "refused", "card"]);

export interface TrackerActivityEntry {
  at: string;
  event: TrackerEvent;
  rexId: string;
  rule: TrackerRuleKind;
  mode: Exclude<TrackerRuleMode, "off">;
  /** `ndx:<project>:<rexId>:<event>`, as the call carries it. */
  requestId: string;
  call: PlannedCall;
  result: TrackerResult;
  problems?: SidecarCallProblem[];
}

/** Where `projectDir`'s activity log lives. */
export function trackerActivityPath(projectDir: string): string {
  return join(worktreeSidecarDir(projectDir), "tracker-activity.jsonl");
}

/**
 * Append `entry`. A server killed mid-append leaves a last line without its
 * newline; the new entry starts on a line of its own, so only the fragment is
 * lost.
 */
export function appendTrackerActivity(projectDir: string, entry: TrackerActivityEntry): void {
  const path = trackerActivityPath(projectDir);
  ensureSidecarDir(worktreeSidecarDir(projectDir));
  const text = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const lead = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(path, lead + JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * The log, oldest first. A line that does not parse is a fragment a crash
 * left mid-append (see {@link appendTrackerActivity}) and is not an entry.
 */
export function readTrackerActivity(projectDir: string): TrackerActivityEntry[] {
  const path = trackerActivityPath(projectDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").flatMap((line) => {
    if (!line) return [];
    try {
      return [JSON.parse(line) as TrackerActivityEntry];
    } catch {
      return [];
    }
  });
}
