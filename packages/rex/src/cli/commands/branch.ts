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

import { result } from "@n-dx/llm-client";
import {
  assignToBranch,
  describeUnits,
  groupWorkSet,
  inheritedUnits,
  requireWorkSetBranch,
  unassignFromBranch,
  WorkSetError,
  type UnitInfo,
} from "../../core/work-set.js";
import { resolveRexPaths } from "../../store/index.js";
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
    if (sub === "show") return await show(rexDir, branch, json);
    if (sub === "add") return await add(rexDir, branch, refs, move, json);
    return await remove(rexDir, branch, refs, json);
  } catch (err) {
    if (err instanceof WorkSetError) throw new CLIError(err.message);
    throw err;
  }
}

async function show(rexDir: string, branch: string, json: boolean): Promise<void> {
  const groups = groupWorkSet((await loadPrdModel(rexDir)).tree, branch);
  if (json) return result(JSON.stringify({ branch, changes: groups }, null, 2));
  if (groups.length === 0) {
    return result(`Branch ${branch} has no work set. Assign tasks with 'rex branch add <id>…'.`);
  }
  result(`Work set of ${branch}:`);
  for (const { change, units } of groups) {
    result(`\n${nodeLabel(change)}  ${change.title}`);
    for (const u of units) result(`  ${unitLine(u)}  [${u.status}]`);
  }
}

async function add(rexDir: string, branch: string, refs: string[], move: boolean, json: boolean): Promise<void> {
  const report = await assignToBranch(rexDir, refs, branch, { move });
  const tree = (await loadPrdModel(rexDir)).tree;
  const from = new Map(report.moved.map((m) => [m.id, m.from]));
  const written = describeUnits(tree, report.assigned).map((u) => ({ ...u, ...(from.has(u.id) ? { movedFrom: from.get(u.id) } : {}) }));
  const unchanged = describeUnits(tree, report.unchanged);
  if (json) return result(JSON.stringify({ branch, assigned: written, unchanged }, null, 2));
  for (const u of written) {
    result(`Added to ${branch}: ${unitLine(u)}${u.movedFrom ? ` (moved from ${u.movedFrom})` : ""}`);
  }
  for (const u of unchanged) result(`Already on ${branch}: ${unitLine(u)}`);
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
