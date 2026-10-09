/**
 * `rex release stamp <version> [dir]`: stamp `shippedIn` on the changes this
 * release ships (see `core/release-stamp.ts`), for any CI's release step.
 *
 * On a v1 tree, or with no rex directory, it prints that there is nothing to
 * stamp and succeeds without running git, taking the lock or reading the tree,
 * so a shallow checkout or a v1 parse warning cannot fail a release.
 *
 * @module rex/cli/commands/release
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadApplyOn } from "../../core/apply-policy.js";
import { gatherReleaseInputs, parseReleaseVersion, planReleaseStamp, type ReleaseStampReport } from "../../core/release-stamp.js";
import { prdLockPath, resolveRexPaths, withLock } from "../../store/index.js";
import { loadPrdModel, PRODUCT_DIRNAME } from "../../store/prd-model-reader.js";
import { writePrdModel } from "../../store/prd-model-writer.js";
import { CLIError } from "../errors.js";
import { result, warn } from "../output.js";

const USAGE = "rex release stamp <version> [dir]";

const HELP = `rex release — release bookkeeping for the change layer

Usage:
  ${USAGE}   Stamp shippedIn on the changes this release ships

Options:
  --dry-run          Report what would be stamped; write nothing
  --format=json      Machine-readable report`;

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

export async function cmdRelease(dir: string, positional: string[], flags: Record<string, string>): Promise<void> {
  const subcommand = positional[0];
  if (!subcommand || flags.help === "true") {
    result(HELP);
    return;
  }
  if (subcommand !== "stamp") {
    throw new CLIError(`Unknown release subcommand: ${subcommand}`, `Usage: ${USAGE}`);
  }
  await stamp(dir, positional[1], flags);
}

async function stamp(dir: string, versionArg: string | undefined, flags: Record<string, string>): Promise<void> {
  const json = flags.format === "json";
  const { rexDir, cacheDir } = resolveRexPaths(dir);

  // Layout first: the v1 path must not fail, whatever else is wrong.
  const nothing = !isDirectory(rexDir)
    ? `there is no rex directory in ${dir}`
    : !isDirectory(join(rexDir, PRODUCT_DIRNAME))
      ? "this project is on the v1 tree; shippedIn is stamped on v2 changes"
      : undefined;
  if (nothing !== undefined) {
    const message = `Nothing to stamp: ${nothing}.`;
    result(json ? JSON.stringify({ version: versionArg ?? null, applied: [], stamped: [], skipped: [], note: message }) : message);
    return;
  }

  if (versionArg === undefined) throw new CLIError("Missing release version.", `Usage: ${USAGE}`);
  const version = parseReleaseVersion(versionArg);
  if (version === undefined) {
    throw new CLIError(`Not a release version: ${versionArg}`, "Pass X.Y.Z or vX.Y.Z; prerelease versions are not stamped.");
  }

  const { applyOn, warnings } = await loadApplyOn(rexDir);
  for (const w of warnings) warn(w);

  const dryRun = flags["dry-run"] === "true";
  const locked = <T>(fn: () => Promise<T>): Promise<T> => (dryRun ? fn() : withLock(prdLockPath(rexDir), fn));
  const report = await locked(async () => {
    const model = await loadPrdModel(rexDir);
    for (const w of model.warnings) warn(w.path + ": " + w.message);
    const gathered = await gatherReleaseInputs(model.tree, { repoDir: dir, cacheDir });
    const now = new Date();
    const plan = planReleaseStamp(model.tree, { version, applyOn, ...gathered, appliedAt: now.toISOString(), now });
    if (plan.changed && !dryRun) await writePrdModel(rexDir, { ...model, tree: plan.tree });
    return plan.report;
  });

  if (json) {
    result(JSON.stringify({ ...report, dryRun }, null, 2));
    return;
  }
  for (const line of formatReport(report, dryRun)) result(line);
}

function formatReport(report: ReleaseStampReport, dryRun: boolean): string[] {
  const would = dryRun ? "Would stamp" : "Stamped";
  const lines: string[] = [];
  if (report.applied.length > 0) lines.push(`${dryRun ? "Would apply" : "Applied"} ${report.applied.length} change(s): ${report.applied.join(", ")}`);
  lines.push(
    report.stamped.length > 0
      ? `${would} ${report.stamped.length} change(s) as shipped in ${report.version}: ${report.stamped.join(", ")}`
      : `No change to stamp as shipped in ${report.version}.`,
  );
  for (const { id, reason } of report.skipped) lines.push(`  not landed, not stamped: ${id} (${reason})`);
  if (dryRun) lines.push("Dry run: nothing was written.");
  return lines;
}
