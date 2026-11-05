/**
 * A project's tracker sync settings, read from the untracked
 * `.n-dx.local.json` under `trackerSync`:
 *
 *   trackerSync: {
 *     connection: "caos",              // the connection the calls go through
 *     profile?: "caos",                // defaults to the connection's own profile
 *     project?: "n-dx",                // the <project> in every requestId; defaults to the directory name
 *     featureMap?: { <release or change>: <tracker feature/epic id> },
 *     rules?: { <ndx event>: "off" | "dry-run" | "on" }
 *   }
 *
 * Every rule is off unless set. Like connections, sync sends calls through a
 * stored credential, so a block in the tracked `.n-dx.json`, or in a
 * `.n-dx.local.json` the repository commits, is ignored: a cloned repository
 * never turns a rule on.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { isLocalConfigTracked, resolveLayout } from "@n-dx/llm-client";
import { TRACKER_EVENTS, type TrackerEvent } from "./server-profiles.js";

export const TRACKER_RULE_MODES = ["off", "dry-run", "on"] as const;
export type TrackerRuleMode = (typeof TRACKER_RULE_MODES)[number];

export interface TrackerSyncConfig {
  connection: string;
  profile?: string;
  project: string;
  featureMap: Record<string, string>;
  rules: Record<TrackerEvent, TrackerRuleMode>;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** A requestId segment: what a project name may hold so the key splits on `:` unambiguously. */
const PROJECT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** Every rule off. */
export function rulesOff(): Record<TrackerEvent, TrackerRuleMode> {
  return Object.fromEntries(TRACKER_EVENTS.map((event) => [event, "off"])) as Record<TrackerEvent, TrackerRuleMode>;
}

/**
 * `raw` as sync settings for `projectDir`, or every problem with it. An
 * unknown event or mode is a problem, never a guess.
 */
export function parseTrackerSync(raw: unknown, projectDir: string): TrackerSyncConfig | { problems: string[] } {
  if (!isRecord(raw)) return { problems: ["trackerSync must be an object"] };
  const problems: string[] = [];
  if (!isString(raw.connection)) problems.push("trackerSync.connection must name a connection");
  if (raw.profile !== undefined && !isString(raw.profile)) problems.push("trackerSync.profile must be a profile name");

  const project = raw.project ?? basename(projectDir);
  if (typeof project !== "string" || !PROJECT_NAME.test(project)) {
    problems.push(`trackerSync.project must match ${PROJECT_NAME} (set it when the directory name does not)`);
  }

  const featureMap: Record<string, string> = {};
  if (raw.featureMap !== undefined && !isRecord(raw.featureMap)) problems.push("trackerSync.featureMap must be an object");
  for (const [key, value] of Object.entries(isRecord(raw.featureMap) ? raw.featureMap : {})) {
    if (isString(value)) featureMap[key] = value;
    else problems.push(`trackerSync.featureMap.${key} must be a tracker id`);
  }

  const rules = rulesOff();
  if (raw.rules !== undefined && !isRecord(raw.rules)) problems.push("trackerSync.rules must be an object keyed by ndx event");
  for (const [event, mode] of Object.entries(isRecord(raw.rules) ? raw.rules : {})) {
    if (!(TRACKER_EVENTS as readonly string[]).includes(event)) problems.push(`trackerSync.rules names ${event}, which is not an ndx event`);
    else if (!(TRACKER_RULE_MODES as readonly unknown[]).includes(mode)) problems.push(`trackerSync.rules.${event} must be off, dry-run or on`);
    else rules[event as TrackerEvent] = mode as TrackerRuleMode;
  }

  if (problems.length > 0) return { problems };
  return {
    connection: raw.connection as string,
    ...(isString(raw.profile) && { profile: raw.profile }),
    project: project as string,
    featureMap,
    rules,
  };
}

/**
 * The project's sync settings: null when it declares none (or only where a
 * repository could have chosen them), problems when the block is malformed.
 */
export function loadTrackerSync(projectDir: string): TrackerSyncConfig | { problems: string[] } | null {
  const { localConfigFile } = resolveLayout(projectDir);
  if (!existsSync(localConfigFile) || isLocalConfigTracked(projectDir)) return null;
  let local: unknown;
  try {
    local = JSON.parse(readFileSync(localConfigFile, "utf-8"));
  } catch (err) {
    return { problems: [`${localConfigFile} is not valid JSON: ${(err as Error).message}`] };
  }
  if (!isRecord(local) || local.trackerSync === undefined) return null;
  return parseTrackerSync(local.trackerSync, projectDir);
}
