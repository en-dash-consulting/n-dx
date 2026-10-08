/**
 * `sourcevision readiness` — print the SDLC readiness scorecard.
 *
 * Reads the `sdlc-profile.json` a prior analysis wrote and scores it, rather
 * than reading the `readiness.json` written beside it. The two agree on the
 * run that produced them, and recomputing is what keeps this command honest
 * after a weight change: `READINESS_WEIGHTS` is code, so a persisted score can
 * be stale in a way the profile underneath it is not.
 *
 * The on-disk profile has had `projectDir` stripped — the artifact is portable
 * across machines — so the agent-safety input is collected here from the
 * directory being asked about. Without that the dimension would score zero for
 * want of a root rather than for want of evidence, and this command's score
 * would differ from the one `analyze` computed for the same repository.
 *
 * @module sourcevision/cli/commands/readiness
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { bold, dim, green, yellow, red } from "@n-dx/llm-client";
import type { SdlcProfile } from "../../schema/v1.js";
import {
  collectAgentSafety,
  computeReadinessScore,
  DIMENSION_LABELS,
  READINESS_DIMENSIONS,
  type ReadinessScore,
} from "../../analyzers/readiness-score.js";
import { resolveSourcevisionPaths } from "../../paths.js";
import { SdlcProfileSchema, formatValidationErrors, validate } from "../../schema/validate.js";
import { CLIError } from "../errors.js";
import { DATA_FILES } from "../sourcevision-core.js";
import { result } from "../output.js";

export interface ReadinessOptions {
  /** Print the machine-readable `ReadinessScore` instead of the scorecard. */
  json?: boolean;
}

/**
 * The caveat that travels with every published score.
 *
 * The feature's binding rule: this says whether tests exist, run, and where
 * the holes are — not whether they are good. Exported so the MCP tool prints
 * the same words rather than its own paraphrase.
 */
export const READINESS_CAVEAT =
  "Heuristic. Detects whether practices exist and are wired up — not whether they are good. " +
  "Reading infrastructure files is configuration review, not a pentest or a CVE scan.";

/** The analyzed profile for a project, and the directory it was read for. */
export interface LoadedSdlcProfile {
  absDir: string;
  profile: SdlcProfile;
}

/**
 * Read and validate the SDLC profile a prior analysis wrote for `dir`.
 *
 * Validated against the schema before anything scores it: the file is on
 * disk, so it can be hand-edited, half-written, or left behind by an analyzer
 * that wrote a different shape. The scorer indexes every section without
 * guarding, so an unvalidated profile missing one would surface as a raw
 * `TypeError` rather than the "re-run analyze" this command owes the user.
 *
 * @throws CLIError when no analysis exists, or the profile cannot be read or
 *   does not match the schema.
 */
export function loadSdlcProfile(dir: string): LoadedSdlcProfile {
  const absDir = resolve(dir);
  const svDir = resolveSourcevisionPaths(absDir).svDir;
  const profilePath = join(svDir, DATA_FILES.sdlcProfile);

  if (!existsSync(profilePath)) {
    throw new CLIError(
      `No SDLC profile found in ${absDir}`,
      "Run 'sourcevision analyze' first — the profile is written as part of an analysis.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(profilePath, "utf-8"));
  } catch (err) {
    throw new CLIError(
      `Could not read ${DATA_FILES.sdlcProfile}: ${err instanceof Error ? err.message : String(err)}`,
      "Re-run 'sourcevision analyze' to rebuild it.",
    );
  }

  const check = validate(SdlcProfileSchema, parsed);
  if (!check.ok) {
    throw new CLIError(
      `${DATA_FILES.sdlcProfile} does not match the schema: ${formatValidationErrors(check.errors)[0]}`,
      "Re-run 'sourcevision analyze' to rebuild it.",
    );
  }

  return { absDir, profile: check.data };
}

/**
 * Score the project at `dir` from its analyzed SDLC profile.
 *
 * Shared by the CLI command and the `get_readiness` MCP tool so the two cannot
 * answer differently for the same repository.
 *
 * @throws CLIError when no analysis, or no valid profile within it, exists.
 */
export function computeReadinessForProject(dir: string): ReadinessScore {
  const { absDir, profile } = loadSdlcProfile(dir);
  return computeReadinessScore(profile, { agentSafety: collectAgentSafety(absDir) });
}

/** Colour a 0-100 score the way the three bands read: weak, partial, strong. */
function colourScore(score: number): string {
  const text = String(score).padStart(3);
  if (score >= 70) return green(text);
  if (score >= 40) return yellow(text);
  return red(text);
}

/** A ten-cell bar, so the dimensions can be compared down the column. */
function bar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + dim("·".repeat(10 - filled));
}

export function cmdReadiness(dir: string, options: ReadinessOptions = {}): void {
  const { absDir, profile } = loadSdlcProfile(dir);
  const score = computeReadinessScore(profile, { agentSafety: collectAgentSafety(absDir) });

  if (options.json) {
    // Printed through console.log rather than result(): --json output is the
    // point of the invocation, so --quiet must not suppress it.
    console.log(JSON.stringify(score, null, 2));
    return;
  }

  result(`\n${bold("SDLC readiness")}  ${colourScore(score.overall)}${dim("/100")}\n`);

  for (const name of READINESS_DIMENSIONS) {
    const dimension = score.dimensions[name];
    const label = DIMENSION_LABELS[name].padEnd(14);
    const weight = dim(`${Math.round(dimension.weight * 100)}%`.padStart(4));
    result(`  ${label} ${colourScore(dimension.score)}  ${bar(dimension.score)} ${weight}`);
  }

  if (score.suggestions.length > 0) {
    result(`\n${bold("Next")}`);
    for (const suggestion of score.suggestions) result(`  • ${suggestion}`);
  }

  // A file the analyzer recognised but could not read is the opposite of an
  // absent one, and a scorecard that hid it would read as "add CI" to someone
  // who has it. Printed whenever there is one, whether or not a gap cites it.
  if (profile.parseFailures.length > 0) {
    result(`\n${bold("Could not parse")}`);
    for (const failure of profile.parseFailures) {
      result(`  ${failure.path} ${dim(`(${failure.kind}: ${failure.reason})`)}`);
    }
  }

  result(`\n${dim(READINESS_CAVEAT)}`);
  result(dim("Full detail: sourcevision readiness --json\n"));
}
