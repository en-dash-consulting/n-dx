/**
 * Report sourcevision's background narration from `.sourcevision/manifest.json`.
 *
 * A cascade `sv analyze` hands escalated zones to a detached `sv narrate`
 * child and returns; until that child finishes, zone names and insights are
 * still landing. Nothing else in `ndx` surfaced that state, so a half-narrated
 * analysis looked finished. This reads the manifest's `narration` field — a
 * plain file read, like the other `.sourcevision/` reads in `cli.js`, not a
 * library import — and formats one line for `ndx status`.
 *
 * Never throws: a missing or unreadable manifest means there is nothing to say.
 *
 * @module n-dx/narration-status
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {{ status: "pending"|"done"|"failed", zones: string[], names?: string[], startedAt: string, finishedAt?: string, pid?: number, log?: string, reason?: string }} NarrationState
 */

/** @param {number} pid */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
}

/** @param {number} ms */
function formatAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/**
 * Read the narration state, or null when there is none.
 * @param {string} dir project root
 * @returns {NarrationState | null}
 */
export function readNarrationState(dir) {
  const path = join(dir, ".sourcevision", "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")).narration ?? null;
  } catch {
    return null;
  }
}

/**
 * One status line for the narration, or null when there is nothing to report
 * (no narration recorded, or it finished).
 *
 * @param {NarrationState | null} narration
 * @param {{ now?: number, isAlive?: (pid: number) => boolean }} [opts]
 * @returns {string | null}
 */
export function formatNarrationStatus(narration, opts = {}) {
  if (!narration || narration.status === "done") return null;
  const now = opts.now ?? Date.now();
  const isAlive = opts.isAlive ?? pidAlive;
  const count = new Set([...(narration.zones ?? []), ...(narration.names ?? [])]).size;
  const what = `${count} zone${count === 1 ? "" : "s"}`;
  const log = narration.log ?? ".sourcevision/.cache/narration.log";

  if (narration.status === "pending") {
    if (narration.pid !== undefined && !isAlive(narration.pid)) {
      return `SourceVision narration: narrator exited without finishing (${what}) — the next 'ndx analyze' re-queues it, or run 'sv narrate .'`;
    }
    const age = formatAge(now - Date.parse(narration.startedAt));
    return `SourceVision narration: running for ${age} (${what}) — log: ${log}`;
  }
  return `SourceVision narration: failed — ${narration.reason ?? "unknown reason"} (${what}); run 'sv narrate .' or 'ndx analyze .'`;
}
