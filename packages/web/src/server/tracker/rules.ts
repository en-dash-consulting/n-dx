/**
 * Tracker sync rules: deterministic, no model. One ndx event for one rex item,
 * the project's sync settings and the profile's mapping in; one plan out.
 *
 * Each event is one rule of one kind (Sidecar design §14.2, CN4):
 * - `create` (change captured or placed with no link): always a card, so a
 *   person picks what the new work item says.
 * - `blocked` (a run failed twice): always a card, so a person confirms who
 *   is blocked on what.
 * - `move` (run started, PR opened, PR merged, release published) on a linked
 *   item: a call made automatically, once its rule is `on`.
 *
 * A rule that is `off` plans nothing; `dry-run` plans the would-be call and
 * makes none. Every call carries the profile's request id property set to
 * `ndx:<project>:<rexId>:<event>`, so the tracker can refuse a repeat.
 *
 * Values the collector already knows go in `values` by input property
 * (dotted for nested); the request id, item id and status always come from
 * here and are never overridden by a value.
 */

import type { FactSource, TrackerEvent, TrackerMapping } from "./server-profiles.js";
import type { TrackerRuleMode, TrackerSyncConfig } from "./sync-config.js";

export type TrackerRuleKind = "create" | "move" | "blocked";

/** The rule each event is. */
export const TRACKER_RULE_KINDS: Record<TrackerEvent, TrackerRuleKind> = {
  "change-captured": "create",
  "run-started": "move",
  "pr-opened": "move",
  "pr-merged": "move",
  "release-published": "move",
  "run-failed-twice": "blocked",
};

/** One ndx event about one rex item, as the collector queues it. */
export interface TrackerEventRecord {
  event: TrackerEvent;
  rexId: string;
  /** The work ref the item links to; absent for an unlinked item. */
  ref?: string;
  /** Input values the collector already knows, by property (dotted for nested). */
  values?: Record<string, unknown>;
  /**
   * What the event itself says, by fact source (`pr-url`, `release`,
   * `run-diagnosis`), for the profile's facts to draw on; not sent as is.
   */
  sources?: Partial<Record<FactSource, string>>;
}

export interface PlannedCall {
  tool: string;
  args: Record<string, unknown>;
}

export type TrackerPlan =
  | { action: "skip"; reason: string }
  | {
      /** `would`: dry-run, no call; `card`: a person decides; `call`: made now. */
      action: "would" | "card" | "call";
      rule: TrackerRuleKind;
      mode: Exclude<TrackerRuleMode, "off">;
      requestId: string;
      call: PlannedCall;
    };

/** The idempotency key of one event on one item. */
export function trackerRequestId(project: string, rexId: string, event: TrackerEvent): string {
  return `ndx:${project}:${rexId}:${event}`;
}

/** `value` at the dotted `property` of `target`, creating the objects on the way. */
function setDotted(target: Record<string, unknown>, property: string, value: unknown): void {
  const keys = property.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/** What `record` plans under `config` and `mapping`. */
export function planTrackerEvent(record: TrackerEventRecord, config: TrackerSyncConfig, mapping: TrackerMapping): TrackerPlan {
  const mode = config.rules[record.event] ?? "off";
  if (mode === "off") return { action: "skip", reason: `the ${record.event} rule is off` };
  const rule = TRACKER_RULE_KINDS[record.event];
  if (rule === "create" && record.ref) return { action: "skip", reason: `${record.rexId} already links to ${record.ref}` };
  if (rule !== "create" && !record.ref) return { action: "skip", reason: `${record.rexId} links to no work item` };

  const requestId = trackerRequestId(config.project, record.rexId, record.event);
  const status = mapping.statusMap[record.event];
  const args: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(record.values ?? {})) setDotted(args, property, value);
  args[mapping.requestIdProperty] = requestId;
  let tool: string;
  if (rule === "create") {
    tool = mapping.createTool;
    if (mapping.createStatusProperty) args[mapping.createStatusProperty] = status;
  } else {
    tool = mapping.moveTool;
    args[mapping.itemIdProperty] = record.ref;
    args[mapping.moveStatusProperty] = status;
  }

  const action = mode === "dry-run" ? "would" : rule === "move" ? "call" : "card";
  return { action, rule, mode, requestId, call: { tool, args } };
}
