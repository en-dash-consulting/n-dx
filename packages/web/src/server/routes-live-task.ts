/**
 * The running-task page's facts — one read per task.
 *
 * GET /api/live/task/:taskId — the task as the served worktree's PRD knows
 * it (title, description, acceptance criteria, priority, epic chain), every
 * hench run of it in that worktree, newest first, and the turn limit runs are
 * held to. Each run carries what the page's header and side column show:
 * tokens and their price, model and weight, where it runs, how it was
 * started, its heartbeat, and the last lines of its log.
 *
 * Scoped to the request's workspace like every other per-worktree route: a
 * task running in another worktree is opened under that worktree's
 * `/w/<key>/` prefix, so `ctx` is already the right one. The progress events
 * and the full log are not here — they stream through the tail routes
 * (`GET /api/hench/runs/:id/events` and `/log`), which this page follows.
 *
 * @module web/server/routes-live-task
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse } from "./response-utils.js";
import { readRunDigests, type RunDigestTokens } from "./routes-worktrees.js";
import { dashboardExecutionsFor, loadHenchConfig } from "./routes-hench.js";
import { heartbeatAgeMs, isRunStale } from "./run-staleness.js";
import { isValidRunId, readLogTailLines, resolveRunLogFile } from "./run-tail.js";
import { estimateCostFromTotals, walkTree } from "./rex-gateway.js";
import { loadPRDSync } from "./prd-io.js";
import { readLiveReviewReport, type LiveReviewReport } from "./live-review-report.js";

/** Lines of log the Work tab shows under the step stream. */
export const LIVE_TASK_LOG_TAIL_LINES = 5;

export interface LiveTaskChainLink {
  id: string;
  title: string;
  level: string;
}

export interface LiveTaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  acceptanceCriteria: string[];
  /** Ancestors, epic first. */
  epicChain: LiveTaskChainLink[];
}

/** What the adversarial review recorded on the run, reduced to what the page says about it. */
export interface LiveTaskReview {
  /** Why the review could not run, when it could not. */
  failed: string | null;
  /** The detail the run recorded with {@link failed}. */
  detail: string | null;
  findings: number | null;
  unresolved: number | null;
}

/** The review the run was launched with (`--review`), as hench recorded it at launch. */
export interface LiveTaskReviewPlan {
  model: string | null;
  /** `flag`, `vendor-config`, `shared-config` or `vendor-default`; other text passes through. */
  modelSource: string | null;
  /** `--review-optional`. */
  optional: boolean;
}

/** What the reviewer spent, apart from the work. */
export interface LiveTaskReviewSpend {
  turns: number;
  tokens: number;
  costUsd: number;
}

export interface LiveTaskRun {
  runId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  heartbeatAgeMs: number | null;
  stale: boolean;
  turns: number | null;
  tokens: RunDigestTokens & { total: number };
  /** USD, priced with the same table as `ndx usage`. */
  costUsd: number;
  /** From the dashboard's own stream, for runs it started; null otherwise. */
  tokensPerSecond: number | null;
  model: string | null;
  vendor: string | null;
  weight: string | null;
  worktreeRoot: string | null;
  branch: string | null;
  startHead: string | null;
  /** Hench process pid; null once finished. */
  pid: number | null;
  /** Null once finished: the dashboard forgets its executions when they end. */
  startedFrom: "dashboard" | "terminal" | null;
  /** The run's final summary or its error, once it has one. */
  outcome: string | null;
  review: LiveTaskReview | null;
  /** Null when the run was not started with `--review` (or predates the record of it). */
  reviewPlan: LiveTaskReviewPlan | null;
  reviewSpend: LiveTaskReviewSpend | null;
  /** The reviewer's report, once it has written one; null before that and when the review failed. */
  reviewReport: LiveReviewReport | null;
  /** Last non-blank lines of the run's log, colour codes removed. */
  logTail: string[];
}

export interface LiveTaskSnapshot {
  generatedAt: string;
  taskId: string;
  /** Null when this worktree's PRD does not have the task. */
  task: LiveTaskItem | null;
  /** Newest first. */
  runs: LiveTaskRun[];
  /** The configured turn limit, or null when hench has no config here. */
  maxTurns: number | null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRunRecord(runsDir: string, runId: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(runsDir, `${runId}.json`), "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function findTask(rexDir: string, taskId: string): LiveTaskItem | null {
  const doc = loadPRDSync(rexDir);
  if (!doc) return null;
  for (const { item, parents } of walkTree(doc.items)) {
    if (item.id !== taskId) continue;
    return {
      id: item.id,
      title: item.title,
      description: str(item.description),
      status: item.status,
      priority: item.priority ?? null,
      acceptanceCriteria: [...(item.acceptanceCriteria ?? [])],
      epicChain: parents.map((p) => ({ id: p.id, title: p.title, level: p.level })),
    };
  }
  return null;
}

function priceTokens(tokens: RunDigestTokens, model: string | null): number {
  const billable = {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheCreationTokens: tokens.cacheCreationInput,
    cacheReadTokens: tokens.cacheReadInput,
  };
  return estimateCostFromTotals(billable, { [model ?? "unknown"]: billable }).totalRaw;
}

function reviewOf(record: Record<string, unknown>): LiveTaskReview | null {
  const review = record.review;
  if (!review || typeof review !== "object") return null;
  const r = review as Record<string, unknown>;
  return {
    failed: str(r.failed),
    detail: str(r.detail),
    findings: typeof r.findingCount === "number" ? r.findingCount : null,
    unresolved: typeof r.unresolvedCount === "number" ? r.unresolvedCount : null,
  };
}

function reviewPlanOf(record: Record<string, unknown>): LiveTaskReviewPlan | null {
  const plan = record.reviewPlan;
  if (!plan || typeof plan !== "object") return null;
  const p = plan as Record<string, unknown>;
  return { model: str(p.model), modelSource: str(p.modelSource), optional: p.optional === true };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function reviewSpendOf(record: Record<string, unknown>, model: string | null): LiveTaskReviewSpend | null {
  const spend = record.reviewSpend;
  if (!spend || typeof spend !== "object") return null;
  const s = spend as Record<string, unknown>;
  const tokens: RunDigestTokens = {
    input: num(s.input),
    output: num(s.output),
    cacheCreationInput: num(s.cacheCreationInput),
    cacheReadInput: num(s.cacheReadInput),
  };
  return {
    turns: num(s.turns),
    tokens: tokens.input + tokens.output + tokens.cacheCreationInput + tokens.cacheReadInput,
    costUsd: priceTokens(tokens, model),
  };
}

function maxTurnsOf(projectDir: string): number | null {
  const value = loadHenchConfig(projectDir)?.maxTurns;
  return typeof value === "number" && value > 0 ? value : null;
}

/** Build the answer for one task in the served worktree. Exported for tests. */
export function buildLiveTaskSnapshot(ctx: ServerContext, taskId: string, now = Date.now()): LiveTaskSnapshot {
  const henchDir = resolveLayout(ctx.projectDir).henchDir;
  const runsDir = join(henchDir, "runs");
  const execution = dashboardExecutionsFor(ctx.projectDir)
    .find((e) => e.taskId === taskId && (e.status === "starting" || e.status === "running"));

  const runs: LiveTaskRun[] = [];
  for (const digest of readRunDigests(ctx.projectDir)) {
    if (digest.taskId !== taskId || digest.id === null || digest.status === null || !isValidRunId(digest.id)) continue;
    const record = readRunRecord(runsDir, digest.id) ?? {};
    const running = digest.status === "running";
    // A task runs at most once at a time per worktree, so a live dashboard
    // execution of it is this run — the rule `GET /api/live` uses too.
    const ownExecution = running ? execution : undefined;
    const log = resolveRunLogFile({ run: { ...record, id: digest.id }, runsDir, worktreeRoot: ctx.projectDir }, [ctx.projectDir]);
    const tokens = { ...digest.tokens, total: digest.tokens.input + digest.tokens.output + digest.tokens.cacheCreationInput + digest.tokens.cacheReadInput };
    const review = reviewOf(record);
    const reviewPlan = reviewPlanOf(record);
    const reviewerModel = reviewPlan?.model ?? str((record.review as { model?: unknown } | undefined)?.model) ?? digest.model;
    runs.push({
      runId: digest.id,
      status: digest.status,
      startedAt: digest.startedAt,
      finishedAt: digest.finishedAt,
      lastActivityAt: digest.lastActivityAt,
      heartbeatAgeMs: running ? heartbeatAgeMs(digest.lastActivityAt, now) : null,
      stale: running && isRunStale(digest.lastActivityAt, now),
      turns: digest.turns,
      tokens,
      costUsd: priceTokens(digest.tokens, digest.model),
      tokensPerSecond: ownExecution?.tokensPerSecond ?? null,
      model: digest.model,
      vendor: digest.vendor,
      weight: str(record.weight),
      worktreeRoot: digest.worktreeRoot,
      branch: digest.branch,
      startHead: str(record.startHead),
      pid: running ? digest.pid : null,
      startedFrom: running ? (ownExecution ? "dashboard" : "terminal") : null,
      outcome: running ? null : str(record.error) ?? str(record.summary),
      review,
      reviewPlan,
      reviewSpend: reviewSpendOf(record, reviewerModel),
      reviewReport: review || reviewPlan ? readLiveReviewReport(henchDir, digest.id) : null,
      logTail: log ? readLogTailLines(log.path, LIVE_TASK_LOG_TAIL_LINES) : [],
    });
  }
  runs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  return {
    generatedAt: new Date(now).toISOString(),
    taskId,
    task: findTask(ctx.rexDir, taskId),
    runs,
    maxTurns: maxTurnsOf(ctx.projectDir),
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const TASK_PATH = /^\/api\/live\/task\/([^/]+)$/;

/** Handle GET /api/live/task/:taskId. Returns true if the request was handled. */
export function handleLiveTaskRoute(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): boolean {
  const match = TASK_PATH.exec((req.url || "/").split("?")[0]);
  if (!match || (req.method || "GET") !== "GET") return false;
  let taskId: string;
  try {
    taskId = decodeURIComponent(match[1]);
  } catch {
    errorResponse(res, 400, "Malformed task id");
    return true;
  }
  jsonResponse(res, 200, buildLiveTaskSnapshot(ctx, taskId));
  return true;
}
