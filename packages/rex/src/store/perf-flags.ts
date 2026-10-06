/**
 * Opt-in switches for the faster PRD read and write paths.
 *
 * Both flags select between two implementations that are meant to produce
 * identical results — the fast one simply avoids work the slow one repeats.
 * They exist as flags, defaulting **off**, because "meant to" is not the same
 * as "proven on your tree": the old path stays the default until an operator
 * turns the new one on deliberately, and stays available to switch back to
 * without a downgrade.
 *
 * Precedence, highest first:
 *   1. environment variable — `REX_FAST_READS`, `REX_FAST_WRITES`
 *   2. `.rex/config.json` → `performance: { fastReads, fastWrites }`
 *   3. off
 *
 * The environment wins so a single command, or a test, can flip a flag
 * without editing a tracked file.
 *
 * Values are read once per `.rex/` directory and cached for the life of the
 * process. A CLI invocation is short enough for that to be invisible; a
 * long-running `ndx start` or MCP server picks up a config change on
 * restart, which is the same contract as every other `.rex/config.json`
 * field the server reads at boot.
 *
 * @module rex/store/perf-flags
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The two paths an operator can switch between. */
export interface RexPerfFlags {
  /**
   * Read the PRD once per command instead of three times.
   *
   * Off: `loadItemsPreferFolderTree` parses the folder tree, *also* calls
   * `store.loadDocument()` (which parses the same tree again), and merges
   * the two — on top of the `loadDocument()` its callers already made. The
   * merge dates from a store that kept routing fields the tree could not
   * represent; since the tree became the backend both sides are the same
   * parse, so the merge is a no-op over identical data.
   *
   * On: the items the caller already loaded are used directly.
   */
  fastReads: boolean;
  /**
   * Write one item's files instead of re-serializing the whole tree.
   *
   * Off: a single-field change (a status transition, say) loads the entire
   * PRD, mutates one node, and hands the whole document to the serializer,
   * which walks every directory to decide that all but one file is
   * unchanged.
   *
   * On: `updateItem` writes the target's `index.md` and refreshes the
   * ancestor indices whose child listings the change affects, leaving the
   * rest of the tree untouched. Falls back to the full write whenever the
   * targeted path cannot prove it is safe — see `targeted-update.ts`.
   */
  fastWrites: boolean;
}

const OFF: RexPerfFlags = { fastReads: false, fastWrites: false };

const cache = new Map<string, RexPerfFlags>();

/**
 * Parse an environment variable as a tri-state: true, false, or unset.
 * Anything unrecognised is treated as unset rather than as false, so a typo
 * falls through to the config file instead of silently pinning the flag off.
 */
function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return undefined;
}

function configFlags(rexDir: string): Partial<RexPerfFlags> {
  try {
    const raw = readFileSync(join(rexDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw) as { performance?: Record<string, unknown> };
    const perf = parsed.performance;
    if (!perf || typeof perf !== "object") return {};
    const out: Partial<RexPerfFlags> = {};
    if (typeof perf["fastReads"] === "boolean") out.fastReads = perf["fastReads"];
    if (typeof perf["fastWrites"] === "boolean") out.fastWrites = perf["fastWrites"];
    return out;
  } catch {
    // Absent or unparseable config is not an error here — a performance
    // switch must never be the thing that stops a command from running.
    return {};
  }
}

/**
 * Resolve the performance flags for a `.rex/` directory.
 *
 * @param rexDir Path to the project's `.rex/` directory.
 */
export function readPerfFlags(rexDir: string): RexPerfFlags {
  const cached = cache.get(rexDir);
  if (cached) return cached;

  const fromConfig = configFlags(rexDir);
  const resolved: RexPerfFlags = {
    fastReads: envFlag("REX_FAST_READS") ?? fromConfig.fastReads ?? OFF.fastReads,
    fastWrites: envFlag("REX_FAST_WRITES") ?? fromConfig.fastWrites ?? OFF.fastWrites,
  };
  cache.set(rexDir, resolved);
  return resolved;
}

/**
 * Drop the cache. Tests that flip a flag between cases need this; nothing in
 * production does, because the flags are read at the start of a process and
 * are not meant to change under a running one.
 */
export function clearPerfFlagCache(): void {
  cache.clear();
}
