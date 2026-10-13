/**
 * `rex migrate-plan` — plan a schema migration and write it out for review.
 *
 * Reads the PRD, runs the registered migration's pipeline
 * (`../../migrations/pipeline.ts`) and writes two files to an operator-chosen
 * path: the JSON plan file that `apply` will read, and a Markdown summary a
 * person reads first. It writes **nothing** to the PRD — planning is a pure
 * read, and the reviewable output is the only artifact.
 *
 * Both files are refused anywhere inside the rex directory, for the same
 * reason `rex export` refuses it: a JSON document written to `.rex/prd.json`
 * would be read *as the PRD* on a checkout without the tree.
 *
 * ## Re-planning
 *
 * The plan at `--out`, when one is already there, is read back as the earlier
 * plan. A model answer recorded in it is reused while the item's content, the
 * question and the model all still match, so re-planning an unchanged tree
 * asks nothing and costs nothing. Its `cutAt` is reused too unless `--cut-at`
 * overrides it, which is what makes the re-run byte-identical rather than
 * merely equivalent — the cut is a property of the plan, not of the clock the
 * re-run happened to see.
 *
 * That is also the retry path after a seam error: the pass is recorded
 * `incomplete`, the answers paid for are kept, and the next run continues from
 * them.
 *
 * ## Which models run
 *
 * `rex.placement.models` decides the placement tiers (text by default) and
 * `--rules-only` turns every model off. Spec drafting runs on the text tier
 * whenever that tier runs. Jev reviews the plan by default — its confident
 * criterion flags are the useful half — and is skipped with a warning when
 * there is no TypeSafe key. Note that a text-only placement *suggests*: under
 * `autoAccept: agree` nothing is auto-placed without a second tier agreeing,
 * so held changes stay held with the suggestion recorded for a reviewer.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TYPESAFE_API_KEY_ENV, askJev } from "@n-dx/llm-client";
import { prdLockPath, resolveRexPaths, resolveStore, withLock } from "../../store/index.js";
import { hasV2Tree } from "../../store/prd-bundle-v2.js";
import { loadPlacementSettings } from "../../core/placement-policy.js";
import { findTestFiles } from "../../core/verify.js";
import { findMigration, MIGRATIONS } from "../../migrations/registry.js";
import { formatPlanFile, readPlanFile, writePlanFile, type PlanFile } from "../../migrations/plan-file.js";
import { v1TreeSource, type V1ToV2Options } from "../../migrations/v1-to-v2/index.js";
import { planSeams } from "../../migrations/v1-to-v2/seams.js";
import { renderPlanSummary, type V1ToV2Plan } from "../../migrations/v1-to-v2/plan-summary.js";
import { atomicWrite } from "../../store/atomic-write.js";
import { CLIError } from "../errors.js";
import { assertOutsideRexDir } from "./export.js";
import { info, result, warn } from "../output.js";

/** The only migration with a source adapter today; `--migration` names another once there is one. */
const DEFAULT_MIGRATION = "v1-to-v2";

/**
 * The model the plan records for the Jev tier.
 *
 * Named here rather than imported: llm-client keeps its wire constants off its
 * public surface, and a test holds it to that
 * (`llm-client/tests/unit/public-api.test.ts`). sourcevision's `classify.ts`
 * names the same string for the same reason. What goes in the plan is the
 * model that was *asked for*; the concrete build that answered comes back on
 * each response and is not what a recorded answer is keyed by.
 */
const JEV_PLAN_MODEL = "jev-latest";

/** `plan.json` → `plan.md`; anything else gets `.md` appended, so the two never collide. */
export function summaryPathFor(outPath: string): string {
  return outPath.endsWith(".json") ? `${outPath.slice(0, -".json".length)}.md` : `${outPath}.md`;
}

/** The earlier plan at `path`, or undefined when there is none. A corrupt one is an error, not a silent fresh start. */
async function readPrevious(path: string): Promise<PlanFile | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return await readPlanFile(path);
  } catch (err) {
    throw new CLIError(
      `${path} exists but is not a migration plan file: ${(err as Error).message}`,
      "Delete it or pass --out=<another path>. Overwriting it would discard the recorded answers.",
    );
  }
}

/** Resolve the cut time: the flag, else the earlier plan's (so a re-run reproduces it), else now. */
function resolveCutAt(flag: string | undefined, previous: PlanFile | undefined): string {
  if (flag !== undefined && flag !== "true") {
    if (Number.isNaN(Date.parse(flag))) throw new CLIError(`--cut-at=${flag} is not an ISO time.`, "Example: --cut-at=2026-10-09T00:00:00.000Z");
    return flag;
  }
  return previous?.header.cutAt ?? new Date().toISOString();
}

/**
 * The model seams, unless `--rules-only`.
 *
 * `planSeams` requires the text tier's placement and spec models to be the
 * same id, because the pass records one model per answer. They resolve
 * through separate task-class routes, so a project that routes them apart
 * gets a CLIError naming `--model` rather than the raw pipeline message.
 */
async function buildSeams(dir: string, rexDir: string, flags: Record<string, string>) {
  if (flags["rules-only"] === "true") return {};

  const { setLLMConfig, setClaudeConfig, setProjectDir } = await import("../../analyze/reason.js");
  const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");
  setLLMConfig(await loadLLMConfig(rexDir));
  setClaudeConfig(await loadClaudeConfig(rexDir));
  setProjectDir(dir);

  const { createTextPlacementModel } = await import("../../analyze/place-reason.js");
  const { createTextSpecModel } = await import("../../analyze/spec-draft-reason.js");
  const model = flags.model === "true" ? undefined : flags.model;

  const { settings, warnings } = await loadPlacementSettings(rexDir);
  for (const message of warnings) warn(message);

  try {
    return planSeams({
      settings,
      text: createTextPlacementModel(model),
      spec: createTextSpecModel(model),
      jev: { model: JEV_PLAN_MODEL, judge: askJev },
      jevAvailable: Boolean(process.env[TYPESAFE_API_KEY_ENV]),
      jevReview: flags["no-jev-review"] !== "true",
      warn,
    });
  } catch (err) {
    throw new CLIError(
      (err as Error).message,
      "Pin both with --model=<model>, or route prd.place and prd.spec.draft to the same model.",
    );
  }
}

export async function cmdMigratePlan(dir: string, flags: Record<string, string>): Promise<void> {
  // The whole argument shape settles before anything is read, so a malformed
  // command fails on the command rather than part-way through a paid run.
  const id = flags.migration === undefined || flags.migration === "true" ? DEFAULT_MIGRATION : flags.migration;
  const migration = findMigration(id);
  if (!migration) {
    throw new CLIError(`Unknown migration "${id}".`, `Registered migrations: ${MIGRATIONS.map((m) => m.id).join(", ")}.`);
  }
  if (migration.id !== DEFAULT_MIGRATION) {
    throw new CLIError(`Migration "${migration.id}" has no source adapter here.`, `Only ${DEFAULT_MIGRATION} can be planned from the PRD.`);
  }

  const out = flags.out;
  if (!out || out === "true") {
    throw new CLIError("Missing --out path.", "Usage: rex migrate-plan --out=<path.json> [dir]");
  }
  // Resolved against the caller's cwd, like every other --out: an operator
  // typing `--out=plan.json` means "here", not "in the project".
  const outPath = resolve(out);
  const summaryPath = flags.summary && flags.summary !== "true" ? resolve(flags.summary) : summaryPathFor(outPath);
  // The summary is written after the plan, so the same path for both destroys
  // the plan in the same run that produced it — and the run reports success.
  // `--out` is already guarded against clobbering a file that is not a plan
  // (readPrevious); this is the other half of that guarantee.
  if (summaryPath === outPath) {
    throw new CLIError(
      "--summary and --out name the same file.",
      "The summary is written after the plan and would overwrite it, discarding the recorded answers. Pass --summary=<another path>, or omit it for <out>.md.",
    );
  }
  assertOutsideRexDir(outPath, dir, "migration plan", "./migration-plan.json");
  assertOutsideRexDir(summaryPath, dir, "migration plan summary", "./migration-plan.md");

  const rexDir = resolveRexPaths(dir).rexDir;
  if (hasV2Tree(rexDir)) {
    throw new CLIError("This project is already on the v2 product and change layers.", "There is no v1 tree to plan a migration from.");
  }

  const previous = await readPrevious(outPath);
  const cutAt = resolveCutAt(flags["cut-at"], previous);

  const store = await resolveStore(rexDir);
  // Read-only span under the PRD lock, the same guarantee `rex export` takes:
  // the tree is written file by file, so an unlocked read racing a writer can
  // classify a mixed state. Never withTransaction — that would write the tree
  // back out, and this command writes nothing to it.
  await mkdir(rexDir, { recursive: true });
  const doc = await withLock(prdLockPath(rexDir), () => store.loadDocument());

  const seams = await buildSeams(dir, rexDir, flags);
  const options: V1ToV2Options = { testFiles: await findTestFiles(dir) };

  info(`Planning ${migration.id} over ${doc.items.length} top-level items (cut at ${cutAt})…`);
  const plan = (await migration.plan(v1TreeSource(doc.items), { cutAt, seams, previous, options })) as V1ToV2Plan;

  await mkdir(dirname(outPath), { recursive: true });
  await writePlanFile(outPath, plan);
  await mkdir(dirname(summaryPath), { recursive: true });
  await atomicWrite(summaryPath, renderPlanSummary(plan));

  const incomplete = plan.header.passes.filter((p) => p.incomplete);
  for (const pass of incomplete) {
    warn(`The ${pass.name} pass stopped: ${pass.incomplete!.error}. Do not apply this plan — re-run to continue from the answers recorded.`);
  }

  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          migration: migration.id,
          out: outPath,
          summary: summaryPath,
          cutAt,
          entries: Object.keys(plan.entries).length,
          areas: plan.summary.areas.length,
          constraints: plan.summary.constraints.length,
          reviewQueue: plan.summary.reviewQueue.length,
          incomplete: incomplete.map((p) => p.name),
          bytes: formatPlanFile(plan).length,
        },
        null,
        2,
      ),
    );
    return;
  }

  result(
    `Planned ${migration.id}: ${Object.keys(plan.entries).length} items, ${plan.summary.areas.length} areas, ${plan.summary.constraints.length} constraints.`,
  );
  result(`Plan:    ${outPath}`);
  result(`Summary: ${summaryPath}`);
  if (plan.summary.reviewQueue.length > 0) {
    info(`${plan.summary.reviewQueue.length} item(s) need a reviewer — see "Review queue" in the summary.`);
  }
}
