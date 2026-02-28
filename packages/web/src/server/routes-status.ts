/**
 * Project status API route — lightweight health indicators for sidebar display.
 *
 * Combines SourceVision analysis freshness, PRD completion metrics, and
 * pending task info into a single endpoint optimized for frequent polling.
 *
 * GET /api/status — project health indicators
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./types.js";
import { DATA_FILES } from "../schema/data-files.js";
import { computeStats, collectCompletedIds, findNextTask } from "./rex-gateway.js";
import type { PRDDocument, TreeStats } from "./rex-gateway.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** SourceVision analysis freshness status. */
export type AnalysisFreshness = "fresh" | "stale" | "unavailable";

export interface SourceVisionStatus {
  /** Whether analysis data exists and how fresh it is. */
  freshness: AnalysisFreshness;
  /** ISO timestamp of last analysis, or null if unavailable. */
  analyzedAt: string | null;
  /** Minutes since last analysis, or null if unavailable. */
  minutesAgo: number | null;
  /** Number of completed analysis modules. */
  modulesComplete: number;
  /** Total number of analysis modules. */
  modulesTotal: number;
}

export interface RexStatus {
  /** Whether a PRD exists. */
  exists: boolean;
  /** PRD completion percentage (0-100). */
  percentComplete: number;
  /** Tree stats breakdown. */
  stats: TreeStats | null;
  /** Whether there are in-progress tasks. */
  hasInProgress: boolean;
  /** Whether there are pending (actionable) tasks. */
  hasPending: boolean;
  /** Title of the next actionable task, or null. */
  nextTaskTitle: string | null;
}

export interface HenchStatus {
  /** Whether hench is configured (config.json exists). */
  configured: boolean;
  /** Number of run files (JSON). */
  totalRuns: number;
  /** Number of currently running (active) runs. */
  activeRuns: number;
  /** Number of running runs that appear stale (no recent activity). */
  staleRuns: number;
}

export interface ProjectStatus {
  sv: SourceVisionStatus;
  rex: RexStatus;
  hench: HenchStatus;
}

// ---------------------------------------------------------------------------
// Freshness threshold — analysis older than 24 hours is "stale"
// ---------------------------------------------------------------------------
const STALE_THRESHOLD_MINUTES = 24 * 60;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface StatusCache {
  status: ProjectStatus;
  timestamp: number;
  projectDir: string;
}

/** Cache TTL — 5 seconds. Short enough for real-time feel, long enough to avoid thrashing. */
const CACHE_TTL_MS = 5_000;

let cache: StatusCache | null = null;

/** Clear the status cache (exposed for testing). */
export function clearStatusCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Status extraction
// ---------------------------------------------------------------------------

const ANALYSIS_MODULES = ["inventory", "imports", "zones", "components", "callgraph"];

function extractSvStatus(ctx: ServerContext): SourceVisionStatus {
  const manifestPath = join(ctx.svDir, DATA_FILES.manifest);
  if (!existsSync(manifestPath)) {
    return {
      freshness: "unavailable",
      analyzedAt: null,
      minutesAgo: null,
      modulesComplete: 0,
      modulesTotal: ANALYSIS_MODULES.length,
    };
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const analyzedAt: string | null = manifest.analyzedAt ?? manifest.timestamp ?? null;
    let minutesAgo: number | null = null;
    let freshness: AnalysisFreshness = "fresh";

    if (analyzedAt) {
      const elapsed = Date.now() - new Date(analyzedAt).getTime();
      minutesAgo = Math.round(elapsed / 60_000);
      freshness = minutesAgo > STALE_THRESHOLD_MINUTES ? "stale" : "fresh";
    }

    const modules: Record<string, { status?: string }> = manifest.modules ?? {};
    const modulesComplete = ANALYSIS_MODULES.filter(
      (m) => modules[m]?.status === "complete",
    ).length;

    return {
      freshness,
      analyzedAt,
      minutesAgo,
      modulesComplete,
      modulesTotal: ANALYSIS_MODULES.length,
    };
  } catch {
    return {
      freshness: "unavailable",
      analyzedAt: null,
      minutesAgo: null,
      modulesComplete: 0,
      modulesTotal: ANALYSIS_MODULES.length,
    };
  }
}

function extractRexStatus(ctx: ServerContext): RexStatus {
  const prdPath = join(ctx.rexDir, "prd.json");
  if (!existsSync(prdPath)) {
    return {
      exists: false,
      percentComplete: 0,
      stats: null,
      hasInProgress: false,
      hasPending: false,
      nextTaskTitle: null,
    };
  }

  try {
    const doc: PRDDocument = JSON.parse(readFileSync(prdPath, "utf-8"));
    const stats = computeStats(doc.items);
    const completedIds = collectCompletedIds(doc.items);
    const nextEntry = findNextTask(doc.items, completedIds);

    return {
      exists: true,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
      stats,
      hasInProgress: stats.inProgress > 0,
      hasPending: stats.pending > 0,
      nextTaskTitle: nextEntry?.item.title ?? null,
    };
  } catch {
    return {
      exists: false,
      percentComplete: 0,
      stats: null,
      hasInProgress: false,
      hasPending: false,
      nextTaskTitle: null,
    };
  }
}

/** Staleness threshold for running runs: 5 minutes. */
const HENCH_STALE_THRESHOLD_MS = 5 * 60 * 1000;

function extractHenchStatus(ctx: ServerContext): HenchStatus {
  const henchDir = join(ctx.projectDir, ".hench");
  const configPath = join(henchDir, "config.json");
  const runsDir = join(henchDir, "runs");

  let totalRuns = 0;
  let activeRuns = 0;
  let staleRuns = 0;

  if (existsSync(runsDir)) {
    try {
      const entries = readdirSync(runsDir);
      const jsonFiles = entries.filter((f) => typeof f === "string" ? f.endsWith(".json") : false);

      const now = Date.now();
      for (const file of jsonFiles) {
        try {
          const raw = readFileSync(join(runsDir, file as string), "utf-8");
          const run = JSON.parse(raw);
          // Only count valid runs (must have id and startedAt) — matches
          // the validation in GET /api/hench/runs to keep counts consistent.
          if (!run.id || !run.startedAt) continue;
          totalRuns++;
          if (run.status === "running") {
            activeRuns++;
            const lastActivity = run.lastActivityAt as string | undefined;
            if (lastActivity) {
              if (now - new Date(lastActivity).getTime() > HENCH_STALE_THRESHOLD_MS) {
                staleRuns++;
              }
            } else {
              // No lastActivityAt field (legacy run still marked running) = stale
              staleRuns++;
            }
          }
        } catch {
          // Skip unreadable/unparseable files — not counted toward totalRuns
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    configured: existsSync(configPath),
    totalRuns,
    activeRuns,
    staleRuns,
  };
}

function buildProjectStatus(ctx: ServerContext): ProjectStatus {
  return {
    sv: extractSvStatus(ctx),
    rex: extractRexStatus(ctx),
    hench: extractHenchStatus(ctx),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const STATUS_PREFIX = "/api/status";

/** Handle project status API requests. Returns true if the request was handled. */
export function handleStatusRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method !== "GET" || url !== STATUS_PREFIX) return false;

  const now = Date.now();
  if (
    cache &&
    cache.projectDir === ctx.projectDir &&
    now - cache.timestamp < CACHE_TTL_MS
  ) {
    jsonResponse(res, 200, cache.status);
    return true;
  }

  const status = buildProjectStatus(ctx);
  cache = { status, projectDir: ctx.projectDir, timestamp: now };
  jsonResponse(res, 200, status);
  return true;
}
