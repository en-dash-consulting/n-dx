import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { computeHealthScore, formatHealthScore } from "../../core/health.js";
import { REX_DIR } from "./constants.js";
import { result } from "../output.js";

/**
 * `rex health [options] [dir]`
 *
 * Show the structure health score for the PRD.
 * Scores 5 dimensions: depth, balance, granularity, completeness, staleness.
 */
export async function cmdHealth(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading PRD
  await ensureLegacyPrdMigrated(dir);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const health = computeHealthScore(doc.items);

  if (flags.format === "json") {
    result(JSON.stringify(health, null, 2));
  } else {
    result(formatHealthScore(health));
  }
}
