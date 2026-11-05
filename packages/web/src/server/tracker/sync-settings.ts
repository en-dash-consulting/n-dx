/**
 * Tracker sync's rule switches, as Settings reads and writes them: the
 * `trackerSync.rules` block of the untracked `.n-dx.local.json` (sync-config.ts
 * says what each value means and why a repository cannot set it). A write
 * changes `rules` and, the first time, names the connection; every other key
 * of the block (`featureMap`, `reviewers`, `project`) is kept as written.
 */

import { updateLocalConfigBlock } from "../local-config-write.js";
import { TRACKER_EVENTS, type TrackerEvent } from "./server-profiles.js";
import { loadTrackerSync, rulesOff, TRACKER_RULE_MODES, type TrackerRuleMode } from "./sync-config.js";

export interface SyncSettings {
  /** The connection the calls go through; null until sync is configured. */
  connection: string | null;
  /** Every event with its mode: off unless set. */
  rules: Record<TrackerEvent, TrackerRuleMode>;
  /** Every event a rule can be set for, in the order the page lists them. */
  events: readonly TrackerEvent[];
  /** Why the block cannot be used, when it is malformed. */
  problems?: string[];
}

/** A request the settings refuse; `message` is safe to show. */
export class SyncSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncSettingsError";
  }
}

export function readSyncSettings(projectDir: string): SyncSettings {
  const loaded = loadTrackerSync(projectDir);
  if (loaded === null) return { connection: null, rules: rulesOff(), events: TRACKER_EVENTS };
  if ("problems" in loaded) return { connection: null, rules: rulesOff(), events: TRACKER_EVENTS, problems: loaded.problems };
  return { connection: loaded.connection, rules: loaded.rules, events: TRACKER_EVENTS };
}

/**
 * Set the mode of each event in `rules`, leaving the others as they were.
 * `connection` names the connection sync goes through; it is required while
 * the block does not name one. Throws {@link SyncSettingsError} for an unknown
 * event or mode, and nothing is written.
 */
export function writeSyncRules(
  projectDir: string,
  rules: Record<string, unknown>,
  connection: string | undefined,
): SyncSettings {
  for (const [event, mode] of Object.entries(rules)) {
    if (!(TRACKER_EVENTS as readonly string[]).includes(event)) throw new SyncSettingsError(`${event} is not an ndx event`);
    if (!(TRACKER_RULE_MODES as readonly unknown[]).includes(mode)) throw new SyncSettingsError(`the rule for ${event} must be off, dry-run or on`);
  }
  updateLocalConfigBlock(projectDir, "trackerSync", (block) => {
    const named = connection ?? (typeof block.connection === "string" ? block.connection : undefined);
    if (!named) throw new SyncSettingsError("name the connection tracker sync goes through");
    const existing = block.rules && typeof block.rules === "object" && !Array.isArray(block.rules) ? (block.rules as Record<string, unknown>) : {};
    return { ...block, connection: named, rules: { ...existing, ...rules } };
  });
  return readSyncSettings(projectDir);
}
