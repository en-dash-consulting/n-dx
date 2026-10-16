/**
 * `rex migrate-plan` — plan a schema migration and write it out for review.
 *
 * Reads the PRD and the outside facts the rules draw on — the repository's test
 * files and the code evidence in the sourcevision analysis — runs the
 * registered migration's pipeline
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
 * asks nothing and costs nothing. Its `cutAt` is reused too when the PRD and
 * the code evidence are the ones it was made from, unless `--cut-at` overrides it, which is what makes the re-run byte-identical rather than
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
import { TYPESAFE_API_KEY_ENV, askJev, exec, resolveLayout, relativeToRoot, routesToTier } from "@n-dx/llm-client";
import type { LLMConfig } from "../../store/project-config.js";
import { MIGRATION_JUDGE_TASK_CLASS } from "../../migrations/v1-to-v2/jev-review-pass.js";
import { prdLockPath, resolveRexPaths, resolveStore, withLock } from "../../store/index.js";
import { hasV2Tree } from "../../store/prd-bundle-v2.js";
import { loadPlacementSettings } from "../../core/placement-policy.js";
import { findTestFiles } from "../../core/verify.js";
import { findMigration, MIGRATIONS } from "../../migrations/registry.js";
import { formatPlanFile, readPlanFile, writePlanFile, type PlanFile } from "../../migrations/plan-file.js";
import { contentHash, sourceDigest, v1TreeSource, V1_TREE_SOURCE_KIND, type V1ToV2Options } from "../../migrations/v1-to-v2/index.js";
import { readCodeEvidence, readCodeEvidenceProvenance } from "../../migrations/v1-to-v2/code-files.js";
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

/** The `--cut-at` flag as an ISO time; undefined when absent. Validated before anything is read. */
function parseCutAtFlag(flag: string | undefined): string | undefined {
  if (flag === undefined || flag === "true") return undefined;
  if (Number.isNaN(Date.parse(flag))) throw new CLIError(`--cut-at=${flag} is not an ISO time.`, "Example: --cut-at=2026-10-09T00:00:00.000Z");
  return flag;
}

/**
 * Resolve the cut time: the flag, else the earlier plan's when it was made from
 * this very source, else now.
 *
 * "This source" is the PRD items (`source.digest`) and the code evidence the
 * plan read (`evidenceDigest`; a plan from before it existed lacks it and so
 * matches only an empty analysis). Reusing the cut across a changed source
 * would carry an old date into `appliedAt` fallbacks and the cut change's id.
 * `reset` is set when an earlier plan was there and its cut was not reused.
 */
function resolveCutAt(
  flag: string | undefined,
  previous: PlanFile | undefined,
  current: { digest: string; evidenceDigest: string },
): { cutAt: string; reset: boolean } {
  if (flag !== undefined) return { cutAt: flag, reset: false };
  if (!previous) return { cutAt: new Date().toISOString(), reset: false };
  const evidence = (previous.summary as V1ToV2Plan["summary"]).evidenceDigest ?? contentHash({});
  if (previous.header.source.digest === current.digest && evidence === current.evidenceDigest) {
    return { cutAt: previous.header.cutAt, reset: false };
  }
  return { cutAt: new Date().toISOString(), reset: true };
}

/**
 * Whether the plan asks Jev to review it (with a key; see `planSeams`).
 *
 * Off under `--no-jev-review`, and when `llm.routes` sends the judge class to a
 * tier (exact or glob) — the project-level opt-out every judge class honours.
 */
export function wantsJevReview(flags: Record<string, string>, llmConfig: LLMConfig): boolean {
  return flags["no-jev-review"] !== "true" && !routesToTier(MIGRATION_JUDGE_TASK_CLASS, llmConfig);
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
  const llmConfig = await loadLLMConfig(rexDir);
  setLLMConfig(llmConfig);
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
      jevReview: wantsJevReview(flags, llmConfig),
      warn,
    });
  } catch (err) {
    throw new CLIError(
      (err as Error).message,
      "Pin both with --model=<model>, or route prd.place and prd.spec.draft to the same model.",
    );
  }
}


/**
 * Whether `sha` is HEAD or an ancestor of it.
 *
 * `merge-base --is-ancestor` answers both at once (a commit is its own
 * ancestor). Anything that is not a clean "yes" — no git, a shallow clone, a
 * commit this checkout never fetched — is treated as "cannot tell" and does
 * not raise a warning, because a false alarm about stale evidence is worse
 * than none.
 */
async function isAncestorOfHead(dir: string, sha: string): Promise<boolean> {
  try {
    const result = await exec("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
      cwd: dir,
      timeout: 10_000,
    });
    if (result.error) return true;
    return result.exitCode === 0;
  } catch {
    return true;
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
  const cutAtFlag = parseCutAtFlag(flags["cut-at"]);

  const store = await resolveStore(rexDir);
  // Read-only span under the PRD lock, the same guarantee `rex export` takes:
  // the tree is written file by file, so an unlocked read racing a writer can
  // classify a mixed state. Never withTransaction — that would write the tree
  // back out, and this command writes nothing to it.
  await mkdir(rexDir, { recursive: true });
  const doc = await withLock(prdLockPath(rexDir), () => store.loadDocument());

  const seams = await buildSeams(dir, rexDir, flags);
  // Both outside facts the rules read are gathered here: the migration itself
  // never touches the filesystem. Without an analysis the code evidence is
  // empty and the plan is what it was before the reader existed.
  const testFiles = await findTestFiles(dir);
  const { files: codeFiles, analysisPresent } = await readCodeEvidence(dir, doc.items, { testFiles });
  // A stale .sourcevision reads exactly like a fresh one — every file parses,
  // every zone has files — so the specs come out looking equally authoritative.
  // Say when the evidence was taken; the operator reviewing the plan cannot
  // tell otherwise, and this repository's own analysis is routinely weeks old.
  const layout = resolveLayout(dir);
  const svName = relativeToRoot(layout, layout.sourcevisionDir);
  const evidenceCount = Object.keys(codeFiles).length;
  let evidenceSummary: V1ToV2Plan["summary"]["codeEvidence"];

  if (evidenceCount > 0) {
    const provenance = await readCodeEvidenceProvenance(dir);
    const offHistory = provenance?.gitSha ? !(await isAncestorOfHead(dir, provenance.gitSha)) : false;
    const taken = provenance?.analyzedAt
      ? `analysed ${provenance.analyzedAt.slice(0, 10)}`
      : "analysis date unrecorded";
    const at = provenance?.gitSha ? ` at ${provenance.gitSha.slice(0, 7)}` : "";
    info(`Code evidence for ${evidenceCount} item(s) from ${svName} (${taken}${at}).`);
    if (offHistory) {
      // Evidence from a commit this branch never had describes a different
      // tree. Worth saying out loud before anyone reviews the specs.
      info(`  \u26a0 That commit is not HEAD or an ancestor of it — the evidence is from another history.`);
    }
    evidenceSummary = {
      items: evidenceCount,
      ...(provenance?.analyzedAt ? { analyzedAt: provenance.analyzedAt } : {}),
      ...(provenance?.gitSha ? { gitSha: provenance.gitSha } : {}),
      ...(offHistory ? { offHistory: true } : {}),
    };
  } else if (analysisPresent) {
    // The analysis is there; nothing in it scored high enough to cite. Telling
    // the operator to run one they already have would waste their time.
    info(`No code evidence: ${svName} has an analysis, but nothing scored high enough to cite. The specs will not reference code.`);
  } else {
    info(`No code evidence: ${svName} has no analysis to read. Run \`ndx analyze .\` first if the specs should cite code.`);
  }
  const options: V1ToV2Options = { testFiles, codeFiles };

  const evidenceDigest = contentHash(codeFiles);
  const { cutAt, reset } = resolveCutAt(cutAtFlag, previous, {
    digest: sourceDigest(V1_TREE_SOURCE_KIND, (await v1TreeSource(doc.items).read()).items),
    evidenceDigest,
  });
  if (reset) {
    info(`The earlier plan at ${outPath} was made from a different PRD or code analysis; the cut time was reset to ${cutAt}.`);
  }

  info(`Planning ${migration.id} over ${doc.items.length} top-level items (cut at ${cutAt})…`);
  const plan = (await migration.plan(v1TreeSource(doc.items), { cutAt, seams, previous, options })) as V1ToV2Plan;

  // Recorded on the plan, not just printed: the cut-day apply and anyone
  // reviewing migration-plan.json later need to know how old the evidence is.
  if (evidenceSummary) plan.summary.codeEvidence = evidenceSummary;
  plan.summary.evidenceDigest = evidenceDigest;

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
