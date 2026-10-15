/**
 * The v2 health report: tree rules, reader warnings and landing check.
 * `rex health` and the MCP `health` tool both build it here, so a person and
 * an agent see the same findings for the same tree.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PRDStore, ParseWarning } from "../store/index.js";
import { resolveRexPaths } from "../store/index.js";
import { loadPrdModel } from "../store/prd-model-reader.js";
import { checkV2TreeHealth, checkChangeLandings } from "../core/health.js";

export interface V2HealthReport {
  treeRules: ReturnType<typeof checkV2TreeHealth>;
  warnings: ParseWarning[];
  landings: Awaited<ReturnType<typeof checkChangeLandings>>;
}

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

/** Whether the report should fail a gate: a rule error or a skipped node. Warnings alone do not. */
export function v2HealthFails(report: V2HealthReport): boolean {
  return report.treeRules.some((f) => f.severity === "error") || report.warnings.some((w) => w.skipped);
}

/** Run the v2 tree rules, reader warnings and landing check for the project at `dir`. */
export async function computeV2Health(dir: string, rexDir: string, store: PRDStore): Promise<V2HealthReport> {
  const model = await loadPrdModel(rexDir);
  const treeRules = checkV2TreeHealth(model.tree, (await store.loadConfig()).structureHealth, new Date(), await readPackageVersion(dir));
  const landings = await checkChangeLandings(model.tree, { repoDir: resolve(dir), cacheDir: resolveRexPaths(dir).cacheDir });
  return { treeRules, warnings: model.warnings, landings };
}
