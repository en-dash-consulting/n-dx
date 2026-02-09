/**
 * Hench API routes — read-only access to agent run history.
 *
 * All endpoints are under /api/hench/.
 *
 * GET  /api/hench/runs        — list runs with summary (newest first, ?limit=N)
 * GET  /api/hench/runs/:id    — full run detail with transcript
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";

const HENCH_PREFIX = "/api/hench/";

/** Minimal run shape for listing (avoids loading full toolCalls/transcript). */
interface RunSummary {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  turns: number;
  summary?: string;
  error?: string;
  model: string;
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  structuredSummary?: {
    counts?: {
      filesRead: number;
      filesChanged: number;
      commandsExecuted: number;
      testsRun: number;
      toolCallsTotal: number;
    };
  };
}

/** Read a single run file, returning the full parsed JSON or null on error. */
function loadRunFile(runsDir: string, id: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(join(runsDir, `${id}.json`), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Strip heavy fields to produce a lightweight summary for list views. */
function toRunSummary(run: Record<string, unknown>): RunSummary {
  const structured = run.structuredSummary as Record<string, unknown> | undefined;
  return {
    id: run.id as string,
    taskId: run.taskId as string,
    taskTitle: run.taskTitle as string,
    startedAt: run.startedAt as string,
    finishedAt: run.finishedAt as string | undefined,
    status: run.status as string,
    turns: run.turns as number,
    summary: run.summary as string | undefined,
    error: run.error as string | undefined,
    model: run.model as string,
    tokenUsage: (run.tokenUsage ?? { input: 0, output: 0 }) as RunSummary["tokenUsage"],
    structuredSummary: structured
      ? { counts: structured.counts as RunSummary["structuredSummary"] extends { counts?: infer C } ? C : never }
      : undefined,
  };
}

/** Handle Hench API requests. Returns true if the request was handled. */
export function handleHenchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(HENCH_PREFIX)) return false;

  const fullPath = url.slice(HENCH_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  const runsDir = join(ctx.projectDir, ".hench", "runs");

  // GET /api/hench/runs — list runs with summary
  if (path === "runs" && method === "GET") {
    let files: string[];
    try {
      files = readdirSync(runsDir);
    } catch {
      jsonResponse(res, 200, { runs: [] });
      return true;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    // Parse limit from query string
    let limit = 0;
    if (qIdx !== -1) {
      const params = new URLSearchParams(fullPath.slice(qIdx));
      const limitStr = params.get("limit");
      if (limitStr) limit = parseInt(limitStr, 10);
    }

    // Load all runs, extract summaries, sort by startedAt descending
    const summaries: RunSummary[] = [];
    for (const file of jsonFiles) {
      const id = file.replace(/\.json$/, "");
      const run = loadRunFile(runsDir, id);
      if (run && run.id && run.startedAt) {
        summaries.push(toRunSummary(run));
      }
    }

    summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const result = limit > 0 ? summaries.slice(0, limit) : summaries;
    jsonResponse(res, 200, { runs: result });
    return true;
  }

  // GET /api/hench/runs/:id — full run detail
  const runsMatch = path.match(/^runs\/([^/?]+)$/);
  if (runsMatch && method === "GET") {
    const runId = runsMatch[1];
    const run = loadRunFile(runsDir, runId);
    if (!run) {
      errorResponse(res, 404, `Run "${runId}" not found`);
      return true;
    }
    jsonResponse(res, 200, run);
    return true;
  }

  return false;
}
