/**
 * `rex migrate --plan [--out <path>] [--rules-only] [--model <id>] [--cut-at <iso>] [dir]`
 *
 * Plans the v1 → v2 migration and writes the plan file for review. Reads the
 * v1 folder tree and the repository's test files, runs the registered
 * migration (`../../migrations/`), and writes nothing in the rex directory:
 * the plan goes to `<project>/.ndx-migration/plan.json` by default, where a
 * `.gitignore` of its own keeps it out of commits, or to `--out`.
 *
 * Defaults: the text model places held changes and redrafts capability specs
 * (one model for both); Jev reviews the plan only when `TYPESAFE_API_KEY` is
 * set, else the pass is skipped with one warning; Jev does not place. A text
 * pick is a suggestion: the change stays held for the Inbox. `--rules-only`
 * turns every model pass off.
 *
 * Re-planning reuses the answers and the cut time of the plan already at the
 * output path, so an unchanged tree writes an identical file. A model pass
 * that stopped on an error is reported after the plan is written, with a
 * non-zero exit: the answers paid for are kept for the retry.
 *
 * @module rex/cli/commands/migrate
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { askJev, TYPESAFE_API_KEY_ENV } from "@n-dx/llm-client";
import { createTextPlacementModel } from "../../analyze/place-reason.js";
import { createTextSpecModel } from "../../analyze/spec-draft-reason.js";
import { findTestFiles } from "../../core/verify.js";
import type { PlacementSettings } from "../../core/placement-policy.js";
import { findMigration } from "../../migrations/registry.js";
import { incompletePasses, isPlanComplete, readPlanFile, writePlanFile, type PlanFile } from "../../migrations/plan-file.js";
import { planSeams } from "../../migrations/v1-to-v2/seams.js";
import { v1TreeSource, type V1ToV2Entry, type V1ToV2Summary } from "../../migrations/v1-to-v2/index.js";
import { PRD_TREE_DIRNAME, resolveRexPaths, resolveStore } from "../../store/index.js";
import { hasV2Tree } from "../../store/prd-bundle-v2.js";
import { CLIError } from "../errors.js";
import { info, result, warn } from "../output.js";
import { assertOutsideRexDir } from "./export.js";

const MIGRATION_ID = "v1-to-v2";
/** Directory of the default plan path, beside `.rex/` and never inside it. */
export const PLAN_DIRNAME = ".ndx-migration";
export const PLAN_FILENAME = "plan.json";

/** Text places and drafts; a pick is only a suggestion, so nothing is accepted without a person. */
const PLAN_PLACEMENT: PlacementSettings = { models: "text", autoAccept: "none" };
/** The model name recorded for Jev: a plan is reused only while the recorded model matches. */
const JEV_MODEL_NAME = "jev-latest";

export async function cmdMigrate(dir: string, flags: Record<string, string>): Promise<void> {
  if (flags.plan !== "true") {
    throw new CLIError("Nothing to do: pass --plan.", "Usage: rex migrate --plan [--out <path>] [--rules-only] [dir]");
  }
  const projectDir = resolve(dir);
  const rexDir = resolveRexPaths(projectDir).rexDir;
  if (hasV2Tree(rexDir)) throw new CLIError("This project already uses the v2 layout: nothing to plan.");
  if (!existsSync(join(rexDir, PRD_TREE_DIRNAME))) {
    throw new CLIError(
      `No PRD folder tree at ${join(rexDir, PRD_TREE_DIRNAME)}.`,
      "Run 'rex migrate-to-folder-tree' first if the PRD is still in a legacy format.",
    );
  }
  for (const key of ["out", "model", "cut-at"]) {
    if (flags[key] === "true") throw new CLIError(`--${key} needs a value.`);
  }

  const defaultOut = join(projectDir, PLAN_DIRNAME, PLAN_FILENAME);
  const outPath = flags.out ? resolve(flags.out) : defaultOut;
  assertOutsideRexDir(outPath, projectDir, "migration plan", `./${PLAN_FILENAME}`);

  const previous = await readPrevious(outPath);
  const cutAt = flags["cut-at"] ?? previous?.header.cutAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(cutAt))) throw new CLIError(`--cut-at is not an ISO time: ${cutAt}`);

  const doc = await (await resolveStore(rexDir)).loadDocument();
  const testFiles = await findTestFiles(projectDir);

  const rulesOnly = flags["rules-only"] === "true";
  const text = rulesOnly ? undefined : createTextPlacementModel(flags.model);
  const spec = text ? createTextSpecModel(text.model) : undefined;
  const seams = planSeams({
    settings: PLAN_PLACEMENT,
    rulesOnly,
    text,
    spec,
    jev: { model: JEV_MODEL_NAME, judge: askJev },
    jevAvailable: Boolean(process.env[TYPESAFE_API_KEY_ENV]?.trim()),
    jevReview: true,
    warn,
  });

  const migration = findMigration(MIGRATION_ID);
  if (!migration) throw new CLIError(`Migration ${MIGRATION_ID} is not registered.`);
  const plan = await migration.plan(v1TreeSource(doc.items), {
    cutAt,
    seams,
    previous,
    options: { testFiles, placement: PLAN_PLACEMENT },
  });

  await mkdir(dirname(outPath), { recursive: true });
  if (outPath === defaultOut) await writeFile(join(dirname(outPath), ".gitignore"), "*\n", "utf8");
  await writePlanFile(outPath, plan);

  report(plan, outPath);
  if (!isPlanComplete(plan)) {
    const stopped = incompletePasses(plan);
    throw new CLIError(
      `The plan is incomplete: ${stopped.map((p) => `the ${p.name} pass stopped (${p.incomplete.error})`).join("; ")}.`,
      "The answers so far are kept in the plan file: run the command again to continue. Do not apply this plan.",
    );
  }
}

/** The plan already at the output path, when it is one for this migration; any other file there is not overwritten. */
async function readPrevious(path: string): Promise<PlanFile | undefined> {
  if (!existsSync(path)) return undefined;
  let plan: PlanFile;
  try {
    plan = await readPlanFile(path);
  } catch (err) {
    throw new CLIError(`${path} exists and is not a migration plan: ${(err as Error).message}`, "Pick another path with --out, or remove the file.");
  }
  if (plan.header.migration !== MIGRATION_ID) {
    throw new CLIError(`${path} holds a ${plan.header.migration} plan, not ${MIGRATION_ID}.`, "Pick another path with --out, or remove the file.");
  }
  return plan;
}

function report(plan: PlanFile<V1ToV2Entry, V1ToV2Summary>, outPath: string): void {
  const { summary, entries, header } = plan;
  const held = Object.values(entries).filter((e) => e.target === "change" && e.needsPlacement === true);
  const models = header.passes.filter((p) => p.name !== "rules").map((p) => `${p.name} ${p.model}`);
  result(`Wrote migration plan to ${outPath}`);
  info(`Passes: rules${models.length > 0 ? `, ${models.join(", ")}` : " only"}`);
  info(`Items: ${Object.entries(summary.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  info(`Held for placement (Inbox): ${held.length}`);
  info(`Proposed areas: ${summary.areas.length}${summary.areas.map((a) => `\n  ${a.title}${a.notes.length > 0 ? ` (${a.notes.length} to review)` : ""}`).join("")}`);
}
