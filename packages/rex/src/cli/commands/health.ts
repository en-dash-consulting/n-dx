import { resolve } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated, resolveRexPaths } from "../../store/index.js";
import type { ParseWarning } from "../../store/index.js";
import { prdLayout, loadPrdModel } from "../../store/prd-model-reader.js";
import { computeHealthScore, formatHealthScore, checkV2TreeHealth, formatV2Findings, checkChangeLandings, formatLandingHealth } from "../../core/health.js";

import { result } from "../output.js";

/** Nodes the reader skipped; the tree rules never see them, so "no findings" alone would hide them. */
function formatReaderWarnings(warnings: ParseWarning[]): string {
  if (warnings.length === 0) return "";
  return `Reader warnings:\n${warnings.map((w) => `  ${w.path}: ${w.message}`).join("\n")}\n\n`;
}

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

  const rexDir = resolveRexPaths(dir).rexDir;
  const store = await resolveStore(rexDir);

  // A v2 tree has no level-based items to score; the v2 tree rules run instead.
  // A v1 tree takes the path below, unchanged.
  if ((await prdLayout(rexDir)) === "v2") {
    const model = await loadPrdModel(rexDir);
    const findings = checkV2TreeHealth(model.tree, (await store.loadConfig()).structureHealth);
    const landings = await checkChangeLandings(model.tree, { repoDir: resolve(dir), cacheDir: resolveRexPaths(dir).cacheDir });
    result(
      flags.format === "json"
        ? JSON.stringify({ treeRules: findings, warnings: model.warnings, landings }, null, 2)
        : `${formatV2Findings(findings)}\n${formatReaderWarnings(model.warnings)}${formatLandingHealth(landings)}`,
    );
    return;
  }

  const doc = await store.loadDocument();
  const health = computeHealthScore(doc.items);

  if (flags.format === "json") {
    result(JSON.stringify(health, null, 2));
  } else {
    result(formatHealthScore(health));
  }
}
