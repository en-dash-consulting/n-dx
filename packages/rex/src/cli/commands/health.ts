import { resolveStore, ensureLegacyPrdMigrated, resolveRexPaths } from "../../store/index.js";
import type { ParseWarning } from "../../store/index.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import { computeHealthScore, formatHealthScore, formatV2Findings, formatLandingHealth } from "../../core/health.js";
import { computeV2Health, v2HealthFails } from "../v2-health.js";

import { result } from "../output.js";

/** Reader warnings; nodes it skipped never reach the tree rules, so "no findings" alone would hide them. */
function formatReaderWarnings(warnings: ParseWarning[]): string {
  if (warnings.length === 0) return "";
  return `Reader warnings:\n${warnings.map((w) => `  ${w.path}: ${w.message}`).join("\n")}\n\n`;
}

/**
 * `rex health [options] [dir]`
 *
 * v1: the structure health score (depth, balance, granularity, completeness, staleness); always exits 0.
 * v2: the tree rules, reader warnings and landing check; exits 1 on a rule error or a skipped node.
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
    const report = await computeV2Health(dir, rexDir, store);
    result(
      flags.format === "json"
        ? JSON.stringify(report, null, 2)
        : `${formatV2Findings(report.treeRules)}\n${formatReaderWarnings(report.warnings)}${formatLandingHealth(report.landings)}`,
    );
    // Gate like `rex validate`: a rule error or a skipped node fails; warnings alone do not.
    if (v2HealthFails(report)) process.exitCode = 1;
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
