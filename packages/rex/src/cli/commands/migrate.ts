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
 * `rex migrate --apply [--plan=<path>] [dir]` applies the plan: see
 * {@link applyPlan}. `--plan` takes its path only in the `=` form, so a bare
 * `--plan` still means plan mode.
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
import {
  applyV1ToV2,
  MigrationApplyError,
  rehearseV1ToV2,
  V1_KINDS,
  type ApplyV1ToV2Result,
  type KindTally,
  type RehearseV1ToV2Result,
} from "../../migrations/v1-to-v2/apply.js";
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

const USAGE = "Usage: rex migrate --plan [--out <path>] [--rules-only] [dir], or rex migrate --apply [--plan=<path>] [--dry-run] [dir]";

export async function cmdMigrate(dir: string, flags: Record<string, string>): Promise<void> {
  if (flags.apply === "true") return applyPlan(dir, flags);
  if (flags.plan !== "true") throw new CLIError("Nothing to do: pass --plan or --apply.", USAGE);
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

/**
 * `rex migrate --apply`: write the v2 tree from the plan at `--plan=<path>`
 * (default `.ndx-migration/plan.json`) and remove the v1 tree, in one PRD
 * transaction (`migrations/v1-to-v2/apply.ts`). On a v2 tree it reports so and
 * exits zero. With `--dry-run` it runs the same refusals, prints per v1 kind
 * what its items become, the Inbox holds and the dropped values, and writes
 * nothing.
 */
async function applyPlan(dir: string, flags: Record<string, string>): Promise<void> {
  const projectDir = resolve(dir);
  const rexDir = resolveRexPaths(projectDir).rexDir;
  const planPath = flags.plan !== undefined && flags.plan !== "true" ? resolve(flags.plan) : join(projectDir, PLAN_DIRNAME, PLAN_FILENAME);

  let plan: PlanFile | undefined;
  if (existsSync(planPath)) {
    try {
      plan = await readPlanFile(planPath);
    } catch (err) {
      throw new CLIError(`${planPath} is not a migration plan: ${(err as Error).message}`);
    }
  } else if (!hasV2Tree(rexDir)) {
    throw new CLIError(`No migration plan at ${planPath}.`, "Run 'rex migrate --plan' first, or name the plan with --plan=<path>.");
  }

  const store = await resolveStore(rexDir);
  if (flags["dry-run"] === "true") {
    let rehearsal: RehearseV1ToV2Result;
    try {
      rehearsal = await rehearseV1ToV2(rexDir, plan, { load: () => store.loadDocument() });
    } catch (err) {
      if (err instanceof MigrationApplyError) throw new CLIError(err.message);
      throw err;
    }
    reportRehearsal(rehearsal);
    return;
  }
  let outcome: ApplyV1ToV2Result;
  try {
    outcome = await applyV1ToV2(rexDir, plan, { load: () => store.loadDocument() });
  } catch (err) {
    if (err instanceof MigrationApplyError) throw new CLIError(err.message);
    throw err;
  }

  if (outcome.status === "already-v2") {
    result("This project already uses the v2 layout: nothing to apply.");
    if (outcome.removed.length > 0) info(`Removed what an interrupted apply left: ${outcome.removed.join(", ")}`);
    return;
  }
  const { built, nodes, v1Items } = outcome;
  result(`Migrated ${v1Items} v1 items to the v2 layout (${nodes} nodes, the cut change ${built.cut} included).`);
  info(`Inbox (needs placement): ${built.inbox}`);
  if (built.containers.length > 0) info(`Delivery containers listed on the cut change: ${built.containers.length}`);
  if (built.late.length > 0) info(`Newer than the plan: ${built.late.length}`);
  if (built.refitted.length > 0) info(`Moved since the plan, re-fitted: ${built.refitted.length}`);
  if (built.gone.length > 0) info(`In the plan but no longer in the tree: ${built.gone.length}`);
  info(`Removed ${PRD_TREE_DIRNAME}/ and its tree-meta.json. Review the result with 'rex health' and place the Inbox.`);
}

/** What `rex migrate --apply --dry-run` prints: per v1 kind what its items become, what is held, what is dropped. */
function reportRehearsal(rehearsal: RehearseV1ToV2Result): void {
  if (rehearsal.status === "already-v2") {
    result("Dry run: this project already uses the v2 layout: nothing to apply.");
    if (rehearsal.removed.length > 0) info(`Apply would remove what an interrupted apply left: ${rehearsal.removed.join(", ")}`);
    return;
  }
  const { kinds, built, nodes, files, v1Items } = rehearsal;
  result(`Dry run: apply would migrate ${v1Items} v1 items to the v2 layout (${nodes} nodes, the cut change ${built.cut} included). Wrote ${files} files to a temporary directory and read them back. Nothing was written to the project.`);
  for (const kind of V1_KINDS) {
    const t = kinds[kind];
    if (t.total === 0) continue;
    const become = Object.entries(t.become).filter(([, n]) => n > 0).map(([type, n]) => `${n} ${type === "release" ? "dissolved release" : type}`);
    info(`${kind} (${t.total}): ${become.join(", ")}; held for the Inbox ${t.held}; dropped ${t.droppedMeta} droppedMeta, ${t.droppedLog} droppedLog`);
  }
  const sum = (pick: (t: KindTally) => number): number => V1_KINDS.reduce((n, k) => n + pick(kinds[k]), 0);
  info(`Total (${sum((t) => t.total)}): held for the Inbox ${sum((t) => t.held)}; dropped ${sum((t) => t.droppedMeta)} droppedMeta, ${sum((t) => t.droppedLog)} droppedLog`);
  if (built.containers.length > 0) info(`Delivery containers listed on the cut change: ${built.containers.length}`);
  if (built.late.length > 0) info(`Newer than the plan: ${built.late.length}`);
  if (built.refitted.length > 0) info(`Moved since the plan, re-fitted: ${built.refitted.length}`);
  if (built.gone.length > 0) info(`In the plan but no longer in the tree: ${built.gone.length}`);
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
