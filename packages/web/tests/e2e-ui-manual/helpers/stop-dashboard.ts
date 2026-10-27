/** Stop a manual flow's agents while their dashboard can still serve the stop API. */
import { terminateProcessTree } from "@n-dx/llm-client";
import { stopDashboardAndWait, type RunningDashboard } from "../../e2e-ui/helpers/fixture-project.js";

interface StopOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const ACTIVE = new Set(["starting", "running", "in_progress", "pending"]);

/**
 * Read both sources: an execution can be starting before its run is on disk,
 * and an iteration execution's task id can differ from its current run's id.
 * Stay in this fixture's workspace; scope=repo could stop another worktree.
 */
async function stopActiveWork(baseUrl: string, { timeoutMs = 15_000, pollIntervalMs = 200 }: StopOptions): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  const remaining = () => {
    const ms = Math.ceil(deadline - performance.now());
    if (ms <= 0) throw new Error("Manual flow cleanup timed out waiting for active work to stop");
    return ms;
  };
  const request = async (path: string, method = "GET"): Promise<Response> => {
    const response = await fetch(`${baseUrl}${path}`, { method, signal: AbortSignal.timeout(remaining()) });
    // A run can finish between listing and terminating. The next snapshot
    // must still confirm idle; a 404 alone is not evidence of completion.
    if (!response.ok && !(method === "POST" && response.status === 404)) {
      throw new Error(`Manual flow cleanup: ${method} ${path} returned HTTP ${response.status}`);
    }
    return response;
  };
  const readTasks = async (path: string, key: string): Promise<string[]> => {
    const body = await (await request(path)).json() as Record<string, unknown> | null;
    if (!body || !Array.isArray(body[key])) throw new Error(`Manual flow cleanup: invalid ${key} response`);
    const tasks: string[] = [];
    for (const row of body[key]) {
      if (!row || typeof row !== "object" || typeof row.status !== "string") {
        throw new Error(`Manual flow cleanup: invalid entry in ${key}`);
      }
      if (!ACTIVE.has(row.status)) continue;
      if (typeof row.taskId !== "string" || !row.taskId.trim()) {
        throw new Error(`Manual flow cleanup: active ${key} entry has no task id`);
      }
      tasks.push(row.taskId);
    }
    return tasks;
  };

  for (;;) {
    const tasks = new Set([
      ...await readTasks("/api/hench/execute/status", "executions"),
      // No limit: older active records must not be hidden by completed runs.
      ...await readTasks("/api/hench/runs", "runs"),
    ]);
    if (tasks.size === 0) return;
    for (const taskId of tasks) {
      const response = await request(`/api/hench/execute/${encodeURIComponent(taskId)}/terminate`, "POST");
      if (response.ok && (await response.json() as { terminated?: boolean }).terminated !== true) {
        throw new Error(`Manual flow cleanup: termination of ${taskId} was not confirmed`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining())));
  }
}

/**
 * Normal teardown uses the product's termination path and observes idle first.
 * If the API fails or times out, kill the tree before killing its parent:
 * Windows uses taskkill /T; POSIX freezes and walks non-detached descendants.
 * Surface the failure, preserving the fixture for diagnosis instead of
 * deleting files that an unconfirmed worker might still be writing.
 */
export async function stopManualDashboard(dashboard: RunningDashboard, options: StopOptions = {}): Promise<void> {
  try {
    await stopActiveWork(dashboard.baseUrl, options);
  } catch (error) {
    await terminateProcessTree(dashboard.proc, { freeze: true });
    throw error;
  } finally {
    await stopDashboardAndWait(dashboard.proc);
    if (dashboard.proc.exitCode === null && dashboard.proc.signalCode === null) {
      await terminateProcessTree(dashboard.proc, { freeze: true });
      if (dashboard.proc.exitCode === null && dashboard.proc.signalCode === null) {
        throw new Error("Manual flow dashboard did not exit after process-tree termination");
      }
    }
  }
}
