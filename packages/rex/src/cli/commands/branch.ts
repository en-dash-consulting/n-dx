/**
 * `rex branch add|remove|show` — the current branch's work set.
 *
 * A work set is the tasks assigned to a branch, recorded per task as
 * `delivery: { branch }` in `state.yaml` (`core/work-set.ts`); a change's own
 * `delivery` covers its tasks that have none, so `show` lists them and
 * removing the change takes them off. Every
 * subcommand acts on the checked-out branch and refuses on the default branch
 * or a detached HEAD. None of them commits: the assignment is a PRD edit like
 * any other, committed with the branch's work.
 *
 * @module rex/cli/commands/branch
 */

import { result, warn } from "@n-dx/llm-client";
import { unpickableUnits } from "../../core/change-selection.js";
import {
  assignToBranch,
  branchWorkState,
  describeUnits,
  earlierUseOf,
  groupWorkSet,
  inheritedUnits,
  requireWorkSetBranch,
  unassignFromBranch,
  WorkSetError,
  workSetFinishedMessage,
  type UnitInfo,
} from "../../core/work-set.js";
import { openClaimsStore, resolveClaimHolder, resolveRexPaths } from "../../store/index.js";
import { collectForeignClaims } from "../mcp-tools/index.js";
import { loadPrdModel } from "../../store/prd-model-reader.js";
import { CLIError } from "../errors.js";
import { nodeLabel, requireV2 } from "./v2-cli.js";

export const BRANCH_SUBCOMMANDS = ["add", "remove", "show"] as const;

const unitLine = (u: UnitInfo): string => `${nodeLabel(u)}  ${u.title}`;

export async function cmdBranch(
  dir: string,
  sub: string | undefined,
  refs: string[],
  flags: Record<string, string>,
): Promise<void> {
  if (!sub || !(BRANCH_SUBCOMMANDS as readonly string[]).includes(sub)) {
    throw new CLIError(
      sub ? `Unknown branch subcommand: ${sub}` : "Missing branch subcommand.",
      "Use 'rex branch add <id>…', 'rex branch remove <id>…' or 'rex branch show'.",
    );
  }
  const json = flags.format === "json";
  const move = flags.move === "true";
  if (move && sub !== "add") throw new CLIError("--move only applies to 'rex branch add'.");
  if (sub === "show" ? refs.length > 0 : refs.length === 0) {
    throw new CLIError(
      sub === "show" ? `Unexpected argument: ${refs[0]}` : `rex branch ${sub} needs at least one change or task id.`,
      sub === "show" ? "Usage: rex branch show [dir]" : `Usage: rex branch ${sub} <id>…`,
    );
  }

  const rexDir = resolveRexPaths(dir).rexDir;
  await requireV2(rexDir, "branch");
  try {
    const branch = requireWorkSetBranch(dir);
    if (sub === "show") return await show(dir, rexDir, branch, json);
    if (sub === "add") return await add(dir, rexDir, branch, refs, move, json);
    return await remove(rexDir, branch, refs, json);
  } catch (err) {
    if (err instanceof WorkSetError) throw new CLIError(err.message);
    throw err;
  }
}

/**
 * The branch's work set by the rule selection narrows by (`branchWorkState`):
 * none, open units, or finished (selection stays narrowed to it), plus the
 * units an earlier branch of this name left, which are not in the set.
 */
async function show(dir: string, rexDir: string, branch: string, json: boolean): Promise<void> {
  const tree = (await loadPrdModel(rexDir)).tree;
  const state = branchWorkState(tree, dir, branch) ?? { branch, ids: [], hasAssignments: false, earlier: [] };
  // Each open unit selection cannot pick, with why (claims as `rex next` reads them).
  const { skipped } = await collectForeignClaims({ store: openClaimsStore(dir), worktreeRoot: resolveClaimHolder(dir).worktreeRoot });
  const claims = new Map(skipped.map((c) => [c.taskId, c]));
  const unpickable = new Map(unpickableUnits(tree, state.ids, { claims }).map((u) => [u.id, u.reasons]));
  const groups = groupWorkSet(tree, state.ids).map((g) => ({
    ...g,
    units: g.units.map((u) => (unpickable.has(u.id) ? { ...u, cannotPick: unpickable.get(u.id) } : u)),
  }));
  const finished = state.hasAssignments && state.ids.length === 0;
  const earlierUse = earlierUseOf(state);
  if (json) {
    return result(JSON.stringify({ branch, hasWorkSet: state.hasAssignments, finished, changes: groups, ...(earlierUse ? { earlierUse } : {}) }, null, 2));
  }
  if (!state.hasAssignments) result(`Branch ${branch} has no work set. Assign tasks with 'rex branch add <id>…'.`);
  else if (finished) result(`${workSetFinishedMessage("--any")} (${branch}).`);
  else {
    result(`Work set of ${branch}:`);
    for (const { change, units } of groups) {
      result(`\n${nodeLabel(change)}  ${change.title}`);
      for (const u of units) {
        const why = "cannotPick" in u && u.cannotPick ? `  cannot be picked: ${u.cannotPick.join("; ")}` : "";
        result(`  ${unitLine(u)}  [${u.status}]${why}`);
      }
    }
  }
  if (earlierUse) result(`${state.hasAssignments && !finished ? "\n" : ""}${earlierUse.message}.`);
}

async function add(dir: string, rexDir: string, branch: string, refs: string[], move: boolean, json: boolean): Promise<void> {
  const report = await assignToBranch(rexDir, refs, branch, { move, workspace: dir });
  const tree = (await loadPrdModel(rexDir)).tree;
  const from = new Map(report.moved.map((m) => [m.id, m.from]));
  const written = describeUnits(tree, report.assigned).map((u) => ({ ...u, ...(from.has(u.id) ? { movedFrom: from.get(u.id) } : {}) }));
  const unchanged = describeUnits(tree, report.unchanged);
  const warnings = report.warnings.length > 0 ? { warnings: report.warnings } : {};
  if (json) return result(JSON.stringify({ branch, assigned: written, unchanged, ...warnings }, null, 2));
  for (const u of written) {
    result(`Added to ${branch}: ${unitLine(u)}${u.movedFrom ? ` (moved from ${u.movedFrom})` : ""}`);
  }
  for (const u of unchanged) result(`Already on ${branch}: ${unitLine(u)}`);
  for (const w of report.warnings) warn(`Warning: ${w}.`);
}

async function remove(rexDir: string, branch: string, refs: string[], json: boolean): Promise<void> {
  const report = await unassignFromBranch(rexDir, refs, branch);
  const tree = (await loadPrdModel(rexDir)).tree;
  const removed = describeUnits(tree, report.removed.map((r) => r.id)).map((u) => ({
    ...u,
    from: report.removed.find((r) => r.id === u.id)?.from,
  }));
  const inherited = inheritedUnits(tree, report.inherited);
  if (json) return result(JSON.stringify({ branch, removed, ...(inherited.length > 0 ? { inherited } : {}) }, null, 2));
  for (const u of removed) result(`Removed from ${u.from}: ${unitLine(u)}`);
  for (const u of inherited) {
    result(`Not removed: ${unitLine(u)} inherits ${u.from} from change ${nodeLabel(u.change)}  ${u.change.title}; remove the change to take it off.`);
  }
  if (removed.length === 0 && inherited.length === 0) result("Nothing to remove: none of those is on a branch.");
}
