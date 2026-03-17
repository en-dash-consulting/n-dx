/**
 * PRD data fetching hook with structural sharing, dedup, and rate limiting.
 *
 * Encapsulates all PRD + task-usage data fetching logic extracted from
 * PRDView. Manages:
 *
 * - PRD document state (data, loading, error)
 * - Task usage and weekly budget state
 * - Request deduplication (concurrent callers share one in-flight request)
 * - Rate limiting (max 2 requests/sec per endpoint)
 * - Structural sharing via diffDocument (unchanged items keep references)
 * - Visibility-aware polling for task usage
 * - Cleanup of rate limiter timers on unmount
 *
 * @see ../components/prd-tree/tree-differ.ts — structural sharing implementation
 * @see ../messaging/fetch-pipeline.ts — composed dedup + rate limiting
 */

import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { PRDDocumentData } from "../components/prd-tree/types.js";
import type { TaskUsageSummary, WeeklyBudgetResolution } from "../components/prd-tree/types.js";
import { resolveTaskUtilization } from "../components/prd-tree/task-utilization.js";
import { diffDocument } from "../components/prd-tree/tree-differ.js";
import { usePolling } from "./use-polling.js";
import { createFetchPipeline } from "../messaging/index.js";

/** Shape returned by the incremental /api/hench/task-usage endpoint. */
interface ServerTaskUsage {
  totalTokens: number;
  runCount: number;
}

function normalizeWeeklyBudgetResolution(value: unknown): WeeklyBudgetResolution {
  const source = (value as { source?: WeeklyBudgetResolution["source"] } | null | undefined)?.source;
  const budget = (value as { budget?: number | null } | null | undefined)?.budget;
  return {
    budget: typeof budget === "number" && Number.isFinite(budget) ? budget : null,
    source: source ?? "missing_budget",
  };
}

/**
 * Convert server-side incremental task usage into client-side summaries
 * with utilization metadata applied.
 */
function applyUtilizationToTaskUsage(
  serverUsage: Record<string, ServerTaskUsage>,
  weeklyBudget: WeeklyBudgetResolution | null,
): Record<string, TaskUsageSummary> {
  const byTask: Record<string, TaskUsageSummary> = {};
  for (const [taskId, usage] of Object.entries(serverUsage)) {
    byTask[taskId] = {
      totalTokens: usage.totalTokens,
      runCount: usage.runCount,
      utilization: resolveTaskUtilization(usage.totalTokens, weeklyBudget),
    };
  }
  return byTask;
}

function applyWeeklyBudget(
  taskUsageById: Record<string, TaskUsageSummary>,
  weeklyBudget: WeeklyBudgetResolution | null,
): Record<string, TaskUsageSummary> {
  const next: Record<string, TaskUsageSummary> = {};
  for (const [taskId, summary] of Object.entries(taskUsageById)) {
    next[taskId] = {
      ...summary,
      utilization: resolveTaskUtilization(summary.totalTokens, weeklyBudget),
    };
  }
  return next;
}

export interface PRDDataState {
  /** Current PRD document, or null if not yet loaded. */
  data: PRDDocumentData | null;
  /** Setter for optimistic updates from WebSocket/actions. */
  setData: (updater: PRDDocumentData | null | ((prev: PRDDocumentData | null) => PRDDocumentData | null)) => void;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** Error message, or null. */
  error: string | null;
  /** Setter for error state (used by WebSocket pipeline). */
  setError: (error: string | null) => void;
  /** Per-task usage summaries keyed by task ID. */
  taskUsageById: Record<string, TaskUsageSummary>;
  /** Resolved weekly budget (for utilization calculations). */
  weeklyBudget: WeeklyBudgetResolution | null;
  /** Fetch/reconcile PRD data from server. Rate-limited and deduped. */
  fetchPRDData: () => Promise<void>;
  /** Fetch/reconcile task usage data from server. Rate-limited and deduped. */
  fetchTaskUsage: () => Promise<void>;
}

/**
 * Hook managing all PRD data loading, polling, and state.
 *
 * @param prdData - Optional pre-loaded PRD data (skips initial fetch).
 */
export function usePRDData(prdData?: PRDDocumentData | null): PRDDataState {
  const [data, setData] = useState<PRDDocumentData | null>(prdData ?? null);
  const [loading, setLoading] = useState(!prdData);
  const [error, setError] = useState<string | null>(null);
  const [taskUsageById, setTaskUsageById] = useState<Record<string, TaskUsageSummary>>({});
  const [weeklyBudget, setWeeklyBudget] = useState<WeeklyBudgetResolution | null>(null);

  /** Mutable ref so the dedup-wrapped fetchTaskUsage always reads the latest budget. */
  const weeklyBudgetRef = useRef(weeklyBudget);
  weeklyBudgetRef.current = weeklyBudget;

  // ── PRD data fetching (dedup + rate-limited) ─────────────────────

  const prdPipeline = useRef(
    createFetchPipeline(async () => {
      try {
        const res = await fetch("/data/prd.json");
        if (!res.ok) {
          if (res.status === 404) {
            setError("No PRD data found. Run 'rex init' then 'rex analyze' to create one.");
          } else {
            setError(`Failed to load PRD data (${res.status})`);
          }
          return;
        }
        const json = await res.json();
        setData((prev) => diffDocument(prev, json));
        setError(null);
      } catch (_err) {
        setError("Could not fetch PRD data. Is the server running?");
      }
    }, { minIntervalMs: 500 }),
  );

  const fetchPRDData = useCallback(async () => {
    await prdPipeline.current.execute();
  }, []);

  // ── Task usage fetching (dedup + rate-limited) ─────────────────

  const usagePipeline = useRef(
    createFetchPipeline(async () => {
      const [taskUsageResult, utilizationResult] = await Promise.allSettled([
        fetch("/api/hench/task-usage"),
        fetch("/api/token/utilization"),
      ]);

      let resolvedWeeklyBudget = weeklyBudgetRef.current;
      if (utilizationResult.status === "fulfilled" && utilizationResult.value.ok) {
        try {
          const json = await utilizationResult.value.json() as { weeklyBudget?: WeeklyBudgetResolution };
          resolvedWeeklyBudget = normalizeWeeklyBudgetResolution(json.weeklyBudget);
          setWeeklyBudget(resolvedWeeklyBudget);
          setTaskUsageById((prev) => applyWeeklyBudget(prev, resolvedWeeklyBudget));
        } catch {
          // Keep prior budget state on parse errors.
        }
      }

      if (taskUsageResult.status === "fulfilled" && taskUsageResult.value.ok) {
        try {
          const json = await taskUsageResult.value.json() as { taskUsage?: Record<string, ServerTaskUsage> };
          setTaskUsageById(applyUtilizationToTaskUsage(json.taskUsage ?? {}, resolvedWeeklyBudget));
        } catch {
          // Keep existing values on parse errors.
        }
      }
    }, { minIntervalMs: 500 }),
  );

  const fetchTaskUsage = useCallback(async () => {
    await usagePipeline.current.execute();
  }, []);

  // ── Initial fetch ────────────────────────────────────────────────

  useEffect(() => {
    if (prdData) {
      setData(prdData);
      setLoading(false);
      fetchTaskUsage();
      return;
    }

    fetchPRDData().then(() => setLoading(false));
    fetchTaskUsage();
  }, [prdData, fetchPRDData, fetchTaskUsage]);

  // ── Visibility-aware polling ─────────────────────────────────────

  usePolling("prd:task-usage", fetchTaskUsage, 10_000);

  // ── Cleanup ──────────────────────────────────────────────────────

  useEffect(() => {
    const prd = prdPipeline.current;
    const usage = usagePipeline.current;
    return () => {
      prd.dispose();
      usage.dispose();
    };
  }, []);

  return {
    data,
    setData,
    loading,
    error,
    setError,
    taskUsageById,
    weeklyBudget,
    fetchPRDData,
    fetchTaskUsage,
  };
}
