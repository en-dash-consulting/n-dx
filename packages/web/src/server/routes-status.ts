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
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { WorkspaceScoped } from "./workspace-scoped.js";
import { jsonResponse } from "./response-utils.js";
import { DATA_FILES } from "../shared/index.js";
import { computeStats, collectCompletedIds, findNextTask, walkTree } from "./rex-gateway.js";
import type { PRDDocument, TreeStats } from "./rex-gateway.js";
import type { ReadinessScore } from "./domain-gateway.js";
import { loadPRDSync } from "./prd-io.js";
import { isProjectInitialized } from "./routes-static.js";
import { isRunStale } from "./run-staleness.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** SourceVision analysis freshness status. */
export type AnalysisFreshness = "fresh" | "stale" | "unavailable";

/**
 * The SDLC readiness headline, when an analysis has produced one.
 *
 * Just the overall score and when it was computed — enough for a sidebar
 * indicator or a hub card, and deliberately not the per-dimension detail,
 * which belongs to a view that asks for it rather than to a status poll.
 */
export interface ReadinessSummary {
  /** Weighted 0-100 readiness score. Heuristic — see sourcevision's scorer. */
  overall: number;
  /**
   * When the analysis that produced it ran, from the manifest.
   *
   * `readiness.json` is written by the same `analyze` pass as the manifest, so
   * the manifest's timestamp dates the score without the artifact carrying one.
   */
  analyzedAt: string | null;
}

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
  /**
   * SDLC readiness, or null when this analysis produced no readiness artifact.
   *
   * Null rather than absent, and null rather than a throw: an analysis from
   * before readiness existed simply has no `readiness.json`, and so does a
   * project that has never been analysed. Neither is an error.
   */
  readiness: ReadinessSummary | null;
}

/** Per-item branch and source-file attribution, serialized from PRDItem fields. */
export interface PRDItemAttribution {
  id: string;
  /** Git branch the item was attributed to, or null when unset. */
  branch: string | null;
  /** Source PRD file path, or null when unset. */
  sourceFile: string | null;
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
  /** Attribution data for every PRD item: branch and sourceFile, null when absent. */
  items: PRDItemAttribution[];
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
  /**
   * Absolute path of the project directory this server serves.
   *
   * Identifies the server to anything probing the port from outside the
   * process — `ndx start` reads it to tell a peer dashboard for another
   * directory apart from a stranger squatting on 3117, and relocates rather
   * than killing when it is a peer (see `runWeb` in `packages/core/web.js`).
   */
  projectDir: string;
  sv: SourceVisionStatus;
  rex: RexStatus;
  hench: HenchStatus;
  /** Server process metadata — see {@link ServerInfo}. */
  server: ServerInfo;
  /**
   * Whether this project has ever produced real SourceVision analysis or a
   * Rex PRD — the same check `routes-static.ts` uses to decide whether `/`
   * serves the dashboard or the setup-wizard landing page (re-exported here,
   * not reimplemented).
   *
   * The Home next-step panel needs this to tell "not initialised" apart from
   * "initialised but not analysed": both read as `sv.freshness ===
   * "unavailable"`, `rex.exists === false` on their own, since those fields
   * describe *content* (a manifest, a PRD tree) rather than whether the
   * project has been touched by `ndx init`/`sourcevision init`/`rex init` at
   * all. This flag is the one field that distinguishes them.
   */
  initialized: boolean;
}

/**
 * Server process metadata — identifies the running dashboard process itself
 * (as opposed to the project it serves). Shared by GET /api/status and
 * GET /api/config so the viewer footer (PR 7) can read pid/version/cliPath
 * without the heavier status call.
 */
export interface ServerInfo {
  /** Absolute path to the project directory this server serves. */
  projectDir: string;
  /** `@n-dx/web` package version. */
  version: string;
  /**
   * Best-effort path to the CLI that launched this server: `NDX_CLI_PATH` or
   * `N_DX_CLI_PATH` (set by `packages/core/cli.js` to its own path), falling
   * back to `process.argv[1]` when neither is set.
   */
  cliPath: string;
  /** OS process id of this server. */
  pid: number;
  /** Port this server is bound to. */
  port: number | null;
  /** ISO timestamp this server started listening, or null if unknown. */
  startedAt: string | null;
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

/** One cache slot per workspace — a status computed for worktree A is not worktree B's. */
const statusCaches = new WorkspaceScoped<{ entry: StatusCache | null }>(() => ({ entry: null }));

/** Clear the status cache for every workspace (exposed for testing and route invalidation). */
export function clearStatusCache(): void {
  statusCaches.clear();
}

// ---------------------------------------------------------------------------
// Status extraction
// ---------------------------------------------------------------------------

const ANALYSIS_MODULES = ["inventory", "imports", "zones", "components", "callgraph"];

/**
 * Read the readiness headline from `readiness.json`, or null.
 *
 * Every failure mode collapses to null on purpose — the file is absent before
 * the first analysis and on any analysis predating readiness, and a truncated
 * or hand-edited one is not worth failing the whole status poll over. Only a
 * numeric `overall` is accepted, so a malformed file reads as "no readiness"
 * rather than putting `undefined` on the wire.
 */
function readReadiness(svDir: string, analyzedAt: string | null): ReadinessSummary | null {
  const path = join(svDir, DATA_FILES.readiness);
  if (!existsSync(path)) return null;

  try {
    const score = JSON.parse(readFileSync(path, "utf-8")) as Partial<ReadinessScore>;
    if (typeof score.overall !== "number" || !Number.isFinite(score.overall)) return null;
    return { overall: score.overall, analyzedAt };
  } catch {
    return null;
  }
}

function extractSvStatus(ctx: ServerContext): SourceVisionStatus {
  const manifestPath = join(ctx.svDir, DATA_FILES.manifest);
  if (!existsSync(manifestPath)) {
    return {
      freshness: "unavailable",
      analyzedAt: null,
      minutesAgo: null,
      modulesComplete: 0,
      modulesTotal: ANALYSIS_MODULES.length,
      readiness: null,
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
      readiness: readReadiness(ctx.svDir, analyzedAt),
    };
  } catch {
    return {
      freshness: "unavailable",
      analyzedAt: null,
      minutesAgo: null,
      modulesComplete: 0,
      modulesTotal: ANALYSIS_MODULES.length,
      readiness: null,
    };
  }
}

function collectItemAttribution(doc: PRDDocument): PRDItemAttribution[] {
  const result: PRDItemAttribution[] = [];
  for (const { item } of walkTree(doc.items)) {
    result.push({
      id: item.id,
      branch: item.branch ?? null,
      sourceFile: item.sourceFile ?? null,
    });
  }
  return result;
}

function extractRexStatus(ctx: ServerContext): RexStatus {
  const doc = loadPRDSync(ctx.rexDir);
  if (!doc) {
    return {
      exists: false,
      percentComplete: 0,
      stats: null,
      hasInProgress: false,
      hasPending: false,
      nextTaskTitle: null,
      items: [],
    };
  }

  try {
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
      items: collectItemAttribution(doc),
    };
  } catch {
    return {
      exists: false,
      percentComplete: 0,
      stats: null,
      hasInProgress: false,
      hasPending: false,
      nextTaskTitle: null,
      items: [],
    };
  }
}

function extractHenchStatus(ctx: ServerContext): HenchStatus {
  const henchDir = resolveLayout(ctx.projectDir).henchDir;
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
            if (isRunStale(run.lastActivityAt, now)) staleRuns++;
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

// ---------------------------------------------------------------------------
// Server info
// ---------------------------------------------------------------------------

/** Cached `@n-dx/web` package version — read from disk once per process. */
let cachedVersion: string | null = null;

function readWebVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // Mirrors the packageRoot resolution in routes-static.ts: this file lives
    // at <pkg>/src/server/ (dev) or <pkg>/dist/server/ (built) — two levels
    // up from either reaches packages/web/package.json.
    const pkgPath = resolve(thisDir, "../..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    const version = typeof pkg.version === "string" ? pkg.version : "unknown";
    // Only memoize a real version. Caching "unknown" would pin a transient
    // failure (e.g. EMFILE, a not-yet-ready mount) for the life of the
    // process — the next call should retry instead of repeating the failure.
    if (version !== "unknown") cachedVersion = version;
    return version;
  } catch {
    return "unknown";
  }
}

/** Build server process metadata shared by GET /api/status and GET /api/config. */
export function buildServerInfo(ctx: ServerContext): ServerInfo {
  return {
    projectDir: ctx.projectDir,
    version: readWebVersion(),
    cliPath: process.env["NDX_CLI_PATH"] ?? process.env["N_DX_CLI_PATH"] ?? process.argv[1] ?? "",
    pid: process.pid,
    port: ctx.port ?? null,
    startedAt: ctx.startedAt ?? null,
  };
}

function buildProjectStatus(ctx: ServerContext): ProjectStatus {
  return {
    projectDir: ctx.projectDir,
    sv: extractSvStatus(ctx),
    rex: extractRexStatus(ctx),
    hench: extractHenchStatus(ctx),
    server: buildServerInfo(ctx),
    initialized: isProjectInitialized(ctx),
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
  // Strip the query string — a trailing "?_=1" cache-buster (or any future
  // query param) must not fall through this exact-equality match to a 404.
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  if (method !== "GET" || url !== STATUS_PREFIX) return false;

  const now = Date.now();
  const slot = statusCaches.get(ctx);
  if (slot.entry && slot.entry.projectDir === ctx.projectDir && now - slot.entry.timestamp < CACHE_TTL_MS) {
    jsonResponse(res, 200, slot.entry.status);
    return true;
  }

  const status = buildProjectStatus(ctx);
  slot.entry = { status, projectDir: ctx.projectDir, timestamp: now };
  jsonResponse(res, 200, status);
  return true;
}
