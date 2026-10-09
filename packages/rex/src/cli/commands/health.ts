import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
/** The project's package.json `version`, or undefined when there is no package.json or no version. */
async function readPackageVersion(dir: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(resolve(dir), "package.json"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const version: unknown = (JSON.parse(text) as { version?: unknown }).version;
  return typeof version === "string" ? version : undefined;
}

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
    const findings = checkV2TreeHealth(model.tree, (await store.loadConfig()).structureHealth, new Date(), await readPackageVersion(dir));
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
