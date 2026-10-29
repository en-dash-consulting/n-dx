/**
 * `hench run --plan-queue` (`ndx work --plan-queue [--format=json] <dir>`).
 *
 * Reads what the queue planner (`queue/plan-queue.ts`) needs and prints its
 * plan. Advisory: it starts no run, claims no task and writes no file — the
 * claims store is opened read-only and the active-run count reads the lock
 * files without cleaning them.
 *
 * @module hench/cli/commands/plan-queue
 */

import { join } from "node:path";
import { findActionableWork, indexTree, resolveStore, validateRunSettings } from "../../prd/rex-gateway.js";
import type { V2Tree } from "../../prd/rex-gateway.js";
import { resolveTaskModel } from "../../prd/llm-gateway.js";
import { loadConfig } from "../../store/config.js";
import { loadLLMConfig, resolveLLMVendor } from "../../store/project-config.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { loadV2Tree } from "../../agent/planning/work-selection.js";
import { resolveProjectCliName } from "../../agent/planning/cli-identity.js";
import { TaskClaims } from "../../process/task-claims.js";
import { countActiveLocksReadOnly } from "../../process/limiter.js";
import { planQueue } from "../../queue/plan-queue.js";
import type { QueueChange, QueuePlan, QueueTask } from "../../queue/plan-queue.js";
import { CLIError } from "../errors.js";
import { result as output, warn } from "../output.js";

type TreeNode = V2Tree["changes"][number];

/** Statuses selection runs; a task in another status is never a candidate. */
const ACTIONABLE = new Set(["pending", "in_progress", "failing"]);

/** The tier `agent.execute` routes to, as a lane reads it: `free` runs on light. */
function defaultTier(tier: string): string {
  return tier === "free" ? "light" : tier;
}

/** The saved tier of a valid `run` block; a malformed block is ignored whole, as a run does. */
function savedTier(node: TreeNode): string | undefined {
  if (node.run === undefined) return undefined;
  const check = validateRunSettings(node.run);
  return check.ok ? check.value?.tier : undefined;
}

/** A change's `touches`: product node ids. Only changes carry the field. */
function touchesOf(change: TreeNode): string[] {
  const touches = change.type === "change" ? change.touches : undefined;
  return Array.isArray(touches) ? touches.filter((t): t is string => typeof t === "string") : [];
}

/**
 * The planner's input from a v2 tree: the ready units in selection order,
 * passing over `excludeIds`, then any open task of the same change whose
 * every open blocker is already a candidate, so a lane can run it after them.
 */
export function queueInputFromTree(
  tree: V2Tree,
  options: { excludeIds?: ReadonlySet<string>; defaultTier: string },
): { tasks: QueueTask[]; changes: Map<string, QueueChange> } {
  const index = indexTree(tree);
  const units = findActionableWork(tree, options.excludeIds?.size ? { excludeIds: options.excludeIds } : {});
  const changes = new Map<string, QueueChange>();
  const tasks: QueueTask[] = [];
  const candidates = new Set<string>();

  const toTask = (node: TreeNode, change: TreeNode, blockedBy: string[]): QueueTask => {
    const own = savedTier(node);
    const fromChange = node === change ? undefined : savedTier(change);
    return {
      id: node.id,
      title: node.title,
      changeId: change.id,
      tags: [...new Set([...(node.tags ?? []), ...(node === change ? [] : change.tags ?? [])])],
      tier: own ?? fromChange ?? options.defaultTier,
      tierSource: own ? "task.run.tier" : fromChange ? "change.run.tier" : "default",
      blockedBy,
    };
  };

  for (const u of units) {
    const change = u.change as TreeNode;
    if (!changes.has(change.id)) {
      changes.set(change.id, { id: change.id, title: change.title, touches: touchesOf(change) });
    }
    tasks.push(toTask(u.node as TreeNode, change, []));
    candidates.add(u.node.id);
  }

  // Blocked tasks that can follow candidates of their own change in one lane.
  const laneChanges = [...changes.keys()].map((id) => index.resolve(id)).filter((c): c is TreeNode => c !== undefined);
  for (let grew = true; grew; ) {
    grew = false;
    for (const change of laneChanges) {
      const siblings = new Set((change.children ?? []).map((c) => c.id));
      for (const task of change.children ?? []) {
        if (task.type !== "task" || candidates.has(task.id) || options.excludeIds?.has(task.id)) continue;
        if (!ACTIONABLE.has(task.status ?? "pending")) continue;
        const open = (task.blockedBy ?? [])
          .map((ref) => index.resolve(ref))
          .filter((b) => b?.status !== "completed");
        if (open.length === 0) continue; // Runnable yet not selected: passed over for a reason of rex's.
        if (!open.every((b) => b !== undefined && siblings.has(b.id) && candidates.has(b.id))) continue;
        tasks.push(toTask(task, change, open.map((b) => (b as TreeNode).id)));
        candidates.add(task.id);
        grew = true;
      }
    }
  }
  return { tasks, changes };
}

/** The command a lane runs: its tasks one after another, in this worktree. */
export function laneCommand(cliName: string, taskIds: readonly string[]): string {
  return taskIds.map((id) => `${cliName} work --task=${id} --auto .`).join(" && ");
}

export function formatPlan(plan: QueuePlan): string[] {
  const lines = [plan.summary];
  plan.lanes.forEach((lane, i) => {
    lines.push("", `Lane ${i + 1} (change ${lane.changeId}):`, `  ${lane.command}`);
    for (const t of lane.tasks) lines.push(`  • ${t.title} (${t.id}): ${t.reason}`);
  });
  if (plan.excluded.length > 0) {
    lines.push("", "Not in a lane:");
    for (const t of plan.excluded) lines.push(`  • ${t.title} (${t.id}): ${t.reason}`);
  }
  return lines;
}

export async function cmdPlanQueue(dir: string, flags: Record<string, string>): Promise<void> {
  const henchDir = resolveHenchPaths(dir).henchDir;
  const config = await loadConfig(henchDir, { onInvalid: "use-defaults", onWarning: (m) => warn(m) });
  const store = await resolveStore(join(dir, config.rexDir));
  const tree = await loadV2Tree(store);
  if (!tree) {
    throw new CLIError(
      "--plan-queue plans a v2 PRD (product/ and changes/); this project is still on v1.",
      "Migrate it first: ndx migrate .",
    );
  }
  const llmConfig = await loadLLMConfig(henchDir);
  const tier = defaultTier(resolveTaskModel("agent.execute", llmConfig, { vendor: resolveLLMVendor(llmConfig) }).tier);
  const foreign = await TaskClaims.forProject(dir, { readOnly: true }).foreignClaims();
  const { tasks, changes } = queueInputFromTree(tree, { excludeIds: new Set(foreign.keys()), defaultTier: tier });
  const cliName = resolveProjectCliName(dir);
  const plan = planQueue({
    tasks,
    changes,
    activeRuns: await countActiveLocksReadOnly(henchDir),
    runLimit: config.guard.maxConcurrentProcesses,
    command: (ids) => laneCommand(cliName, ids),
  });

  if (flags.format === "json") {
    output(JSON.stringify(plan, null, 2));
    return;
  }
  for (const line of formatPlan(plan)) output(line);
}
