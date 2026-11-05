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

import type { FactSource, TrackerEvent, TrackerFact, TrackerMapping } from "./server-profiles.js";
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
   * What the event itself says, by fact source (`pr-url`, `release` as the
   * version, `codeowners` as the owner of the PR's files), for the profile's
   * facts to draw on; not sent as is.
   */
  sources?: Partial<Record<FactSource, string>>;
  /** The failed run's diagnosis: what blocks it, and the best-ranked way to unblock it. */
  diagnosis?: { summary: string; unblock?: string };
  /** The tracker feature the item's work belongs under, for the `feature-map` source. */
  feature?: { name: string; epic?: string };
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
      /**
       * A required fact no source answered, or work the tracker cannot do. Set,
       * the plan is a card whatever its mode and `call` is incomplete: it is
       * never made, and nothing stands in for the fact.
       */
      missing?: string[];
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

/** The value at dotted `property` of `values`, when one is set. */
function valueAt(values: Record<string, unknown> | undefined, property: string): string | undefined {
  const value = values?.[property];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** What `fact` is from the first of its sources that answers, or why none does. */
function resolveFact(
  fact: TrackerFact,
  record: TrackerEventRecord,
  config: TrackerSyncConfig,
  mapping: TrackerMapping,
  label: string,
): { value: string } | { missing: string } {
  // A value the collector already knows for the property stands for its item and loe sources.
  const known = valueAt(record.values, fact.property);
  if (known) return { value: known };
  let missing = `missing ${fact.fact}: no ${fact.from.join(" or ")} value`;
  for (const source of fact.from) {
    let value: string | undefined;
    switch (source) {
      case "constant":
        value = fact.value;
        break;
      case "profile-default":
        value = (mapping.defaults as Record<string, unknown>)[fact.fact] as string | undefined;
        break;
      case "codeowners": {
        // A CODEOWNERS owner is a GitHub handle; the tracker needs its own user id.
        const owner = record.sources?.codeowners;
        value = owner && config.reviewers[owner];
        if (owner && !value) missing = `missing ${fact.fact}: map ${owner} to a user in ${label} in trackerSync.reviewers`;
        break;
      }
      case "pr-url":
        value = record.sources?.[source];
        break;
      case "release":
        value = record.sources?.release && `shipped in ndx ${record.sources.release}`;
        break;
      case "run-diagnosis":
        value = fact.fact === "whoCanUnblock" ? record.diagnosis?.unblock : record.diagnosis?.summary;
        break;
      case "feature-map": {
        const feature = record.feature;
        value = feature && config.featureMap[feature.name];
        if (feature && !value && mapping.limits.includes("create-feature")) {
          const under = feature.epic ? ` under epic ${feature.epic}` : "";
          missing = `Create feature '${feature.name}'${under} in ${label}, then map it in trackerSync.featureMap`;
        }
        break;
      }
      default:
        break;
    }
    if (typeof value === "string" && value !== "") return { value };
  }
  return { missing };
}

/** What `record` plans under `config` and `mapping`; `label` names the tracker in a card. */
export function planTrackerEvent(
  record: TrackerEventRecord,
  config: TrackerSyncConfig,
  mapping: TrackerMapping,
  label = "the tracker",
): TrackerPlan {
  const mode = config.rules[record.event] ?? "off";
  if (mode === "off") return { action: "skip", reason: `the ${record.event} rule is off` };
  const rule = TRACKER_RULE_KINDS[record.event];
  if (rule === "create" && record.ref) return { action: "skip", reason: `${record.rexId} already links to ${record.ref}` };
  if (rule !== "create" && !record.ref) return { action: "skip", reason: `${record.rexId} links to no work item` };

  const requestId = trackerRequestId(config.project, record.rexId, record.event);
  const status = mapping.statusMap[record.event];
  const args: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(record.values ?? {})) setDotted(args, property, value);
  const missing: string[] = [];
  for (const fact of mapping.facts[record.event] ?? []) {
    const resolved = resolveFact(fact, record, config, mapping, label);
    if ("missing" in resolved) missing.push(resolved.missing);
    else setDotted(args, fact.property, resolved.value);
  }
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

  const call = { tool, args };
  if (missing.length > 0) return { action: "card", rule, mode, requestId, call, missing };
  const action = mode === "dry-run" ? "would" : rule === "move" ? "call" : "card";
  return { action, rule, mode, requestId, call };
}
