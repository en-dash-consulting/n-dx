/**
 * `rex migrate-apply --plan=<path.json> [--dry-run] [dir]` — apply a reviewed
 * migration plan.
 *
 * Writes the v2 tree from the plan `rex migrate-plan` wrote and removes the v1
 * tree, in one PRD transaction (`../../migrations/v1-to-v2/apply.ts`). On a v1
 * tree `--plan` is required, as `migrate-plan` requires `--out`; on a v2 tree
 * it reports so and exits zero, removing a `prd_tree/` an interrupted apply
 * left and refusing one it cannot show was. With `--dry-run` it runs the same refusals,
 * writes and reads back the tree in a temporary directory, prints per v1 kind
 * what its items become, the Inbox holds and the dropped values, and writes
 * nothing to the project.
 *
 * @module rex/cli/commands/migrate-apply
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyV1ToV2,
  MigrationApplyError,
  rehearseV1ToV2,
  V1_KINDS,
  type ApplyV1ToV2Result,
  type KindTally,
  type LeftoverProof,
  type RehearseV1ToV2Result,
} from "../../migrations/v1-to-v2/apply.js";
import { readPlanFile, type PlanFile } from "../../migrations/plan-file.js";
import { PRD_TREE_DIRNAME, resolveRexPaths, resolveStore } from "../../store/index.js";
import { hasV2Tree } from "../../store/prd-bundle-v2.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

const USAGE = "Usage: rex migrate-apply --plan=<path.json> [--dry-run] [dir]";

export async function cmdMigrateApply(dir: string, flags: Record<string, string>): Promise<void> {
  const rexDir = resolveRexPaths(dir).rexDir;
  const planFlag = flags.plan !== undefined && flags.plan !== "true" ? flags.plan : undefined;

  let plan: PlanFile | undefined;
  if (planFlag !== undefined) {
    // Resolved against the caller's cwd, as migrate-plan resolves --out.
    const planPath = resolve(planFlag);
    if (existsSync(planPath)) {
      try {
        plan = await readPlanFile(planPath);
      } catch (err) {
        throw new CLIError(`${planPath} is not a migration plan: ${(err as Error).message}`);
      }
    } else if (!hasV2Tree(rexDir)) {
      throw new CLIError(`No migration plan at ${planPath}.`, "Run 'rex migrate-plan --out=<path.json>' first.");
    }
  } else if (!hasV2Tree(rexDir)) {
    throw new CLIError("Missing --plan path.", USAGE);
  }

  const store = await resolveStore(rexDir);
  const load = () => store.loadDocument();
  if (flags["dry-run"] === "true") {
    reportRehearsal(await asCliError(() => rehearseV1ToV2(rexDir, plan, { load })));
    return;
  }
  reportApply(await asCliError(() => applyV1ToV2(rexDir, plan, { load })));
}

/** A refusal from the apply library is the operator's to act on: a CLIError, without a stack. */
async function asCliError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MigrationApplyError) throw new CLIError(err.message);
    throw err;
  }
}

function reportApply(outcome: ApplyV1ToV2Result): void {
  if (outcome.status === "already-v2") {
    result("This project already uses the v2 layout: nothing to apply.");
    if (outcome.removed.length > 0) info(`Removed what an interrupted apply left (${proofText(outcome.proof)}): ${outcome.removed.join(", ")}`);
    return;
  }
  const { built, nodes, v1Items } = outcome;
  result(`Migrated ${v1Items} v1 items to the v2 layout (${nodes} nodes, the cut change ${built.cut} included).`);
  info(`Inbox (needs placement): ${built.inbox}`);
  reportBuilt(built);
  info(`Removed ${PRD_TREE_DIRNAME}/ and its tree-meta.json. Review the result with 'rex health' and place the Inbox.`);
}

/** What `--dry-run` prints: per v1 kind what its items become, what is held, what is dropped. */
function reportRehearsal(rehearsal: RehearseV1ToV2Result): void {
  if (rehearsal.status === "already-v2") {
    result("Dry run: this project already uses the v2 layout: nothing to apply.");
    if (rehearsal.removed.length > 0) info(`Apply would remove what an interrupted apply left (${proofText(rehearsal.proof)}): ${rehearsal.removed.join(", ")}`);
    return;
  }
  const { kinds, built, nodes, files, v1Items } = rehearsal;
  result(
    `Dry run: apply would migrate ${v1Items} v1 items to the v2 layout (${nodes} nodes, the cut change ${built.cut} included). ` +
      `Wrote ${files} files to a temporary directory and read them back. Nothing was written to the project.`,
  );
  for (const kind of V1_KINDS) {
    const t = kinds[kind];
    if (t.total === 0) continue;
    const become = Object.entries(t.become)
      .filter(([, n]) => n > 0)
      .map(([type, n]) => `${n} ${type === "release" ? "dissolved release" : type}`);
    info(`${kind} (${t.total}): ${become.join(", ")}; held for the Inbox ${t.held}; dropped ${t.droppedMeta} droppedMeta, ${t.droppedLog} droppedLog`);
  }
  const sum = (pick: (t: KindTally) => number): number => V1_KINDS.reduce((n, k) => n + pick(kinds[k]), 0);
  info(`Total (${sum((t) => t.total)}): held for the Inbox ${sum((t) => t.held)}; dropped ${sum((t) => t.droppedMeta)} droppedMeta, ${sum((t) => t.droppedLog)} droppedLog`);
  reportBuilt(built);
}

/** Why the v1 files beside the v2 tree are safe to remove. */
function proofText(proof: LeftoverProof | undefined): string {
  if (proof === "plan") return "it matches the plan's source";
  if (proof === "ids") return "every id it holds is in the v2 tree";
  return "it holds no item";
}

function reportBuilt(built: Extract<ApplyV1ToV2Result, { status: "applied" }>["built"]): void {
  if (built.containers.length > 0) info(`Delivery containers listed on the cut change: ${built.containers.length}`);
  if (built.late.length > 0) info(`Newer than the plan: ${built.late.length}`);
  if (built.refitted.length > 0) info(`Moved since the plan, re-fitted: ${built.refitted.length}`);
  if (built.gone.length > 0) info(`In the plan but no longer in the tree: ${built.gone.length}`);
}
