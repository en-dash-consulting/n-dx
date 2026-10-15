import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated, resolveRexPaths } from "../../store/index.js";
import type { PRDStore, ParseWarning } from "../../store/index.js";
import { prdLayout, loadPrdModel } from "../../store/prd-model-reader.js";
import { computeHealthScore, formatHealthScore, checkV2TreeHealth, formatV2Findings, checkChangeLandings, formatLandingHealth } from "../../core/health.js";

import type { StructureHealthThresholds } from "../../schema/index.js";
import { result } from "../output.js";

/**
 * The v2 health report: tree rules, reader warnings and landing check.
 * `rex health` and the MCP `health` tool both build it here, so a person and
 * an agent see the same findings for the same tree.
 */
export interface V2HealthReport {
  treeRules: ReturnType<typeof checkV2TreeHealth>;
  warnings: ParseWarning[];
  landings: Awaited<ReturnType<typeof checkChangeLandings>>;
}

/** Reader warnings; nodes it skipped never reach the tree rules, so "no findings" alone would hide them. */
function formatReaderWarnings(warnings: ParseWarning[]): string {
  if (warnings.length === 0) return "";
  return `Reader warnings:\n${warnings.map((w) => `  ${w.path}: ${w.message}`).join("\n")}\n\n`;
}

/**
 * The project's package.json `version`, or undefined when there is no package.json,
 * it is not valid JSON (a half-saved edit), or it has no string version. The
 * release-token rule skips without a version; a broken package.json is not a PRD
 * problem and must not hide the health report.
 */
async function readPackageVersion(dir: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(resolve(dir), "package.json"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return undefined;
  }
  const version = (manifest as { version?: unknown } | null)?.version;
  return typeof version === "string" ? version : undefined;
}

/** Whether the report should fail a gate: a rule error or a skipped node. Warnings alone do not. */
export function v2HealthFails(report: V2HealthReport): boolean {
  return report.treeRules.some((f) => f.severity === "error") || report.warnings.some((w) => w.skipped);
}

/** Run the v2 tree rules, reader warnings and landing check for the project at `dir`. */
export async function computeV2Health(
  dir: string,
  rexDir: string,
  structureHealth: StructureHealthThresholds | undefined,
): Promise<V2HealthReport> {
  const model = await loadPrdModel(rexDir);
  const treeRules = checkV2TreeHealth(model.tree, structureHealth, new Date(), await readPackageVersion(dir));
  const landings = await checkChangeLandings(model.tree, { repoDir: resolve(dir), cacheDir: resolveRexPaths(dir).cacheDir });
  return { treeRules, warnings: model.warnings, landings };
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
    const report = await computeV2Health(dir, rexDir, (await store.loadConfig()).structureHealth);
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
