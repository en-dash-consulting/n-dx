/**
 * Sourcevision API routes — structured access to analysis data.
 *
 * All endpoints are under /api/sv/.
 *
 * GET /api/sv/manifest      — analysis metadata and git info
 * GET /api/sv/inventory     — file listing with metadata
 * GET /api/sv/imports       — dependency graph
 * GET /api/sv/zones         — architectural zone map
 * GET /api/sv/components    — React component catalog
 * GET /api/sv/context       — full CONTEXT.md contents
 * GET /api/sv/pr-markdown   — latest PR markdown (if available)
 * GET /api/sv/summary       — summary stats across all analyses
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";
import { DATA_FILES } from "../shared/data-files.js";
import {
  classifyPRMarkdownRefreshFailureCode,
} from "./pr-markdown-refresh-diagnostics.js";

const SV_PREFIX = "/api/sv/";

/** Safely read and parse a JSON data file. Returns null on failure. */
function loadDataFile(ctx: ServerContext, filename: string): unknown | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Safely read a text data file. Returns null on failure. */
function loadTextFile(ctx: ServerContext, filename: string): string | null {
  const filePath = join(ctx.svDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

const PR_MARKDOWN_FILES = ["pr-markdown.md", "PR_MARKDOWN.md", "pr.md", "PR.md"] as const;
const PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE = "pr-markdown.artifact.json";
const PR_MARKDOWN_STALE_MS = 30 * 60 * 1000;
type PRMarkdownCacheStatus = "missing" | "fresh" | "stale";
type PRMarkdownMode = "normal" | "fallback";

interface PRMarkdownState {
  trackedFilesSignature: string | null;
  gitStatusSignature: string | null;
  gitDiffSignature: string | null;
  signature: string;
  availability: "ready" | "unsupported" | "no-repo" | "error";
  message: string | null;
  warning: string | null;
  baseRange: string | null;
  cacheStatus: PRMarkdownCacheStatus;
  generatedAt: string | null;
  staleAfterMs: number;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
}

interface PRMarkdownArtifactPayload {
  markdown: string;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
}

function toOptionalPercentage(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.round(value);
  if (normalized < 0 || normalized > 100) return undefined;
  return normalized;
}

function parsePRMarkdownArtifactPayload(raw: unknown): PRMarkdownArtifactPayload | null {
  const data = toRecord(raw);
  if (!data) return null;
  const markdown = asNonEmptyString(data.markdown);
  if (!markdown) return null;
  const mode = data.mode === "fallback" ? "fallback" : data.mode === "normal" ? "normal" : null;
  if (!mode) return null;
  const confidence = mode === "fallback" ? toOptionalPercentage(data.confidence) : undefined;
  const coverage = mode === "fallback" ? toOptionalPercentage(data.coverage) : undefined;
  return {
    markdown,
    mode,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(coverage !== undefined ? { coverage } : {}),
  };
}

function loadPRMarkdownArtifactPayload(ctx: ServerContext): PRMarkdownArtifactPayload | null {
  const artifactPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
  if (!existsSync(artifactPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
    return parsePRMarkdownArtifactPayload(parsed);
  } catch {
    return null;
  }
}

type GitCommandResult =
  | { ok: true; output: string }
  | { ok: false; reason: "missing-git" | "not-a-repo" | "failed" };

/** Run git and return trimmed output, or null when unavailable. */
function gitOutput(ctx: ServerContext, args: string[]): string | null {
  const result = gitOutputResult(ctx, args);
  return result.ok ? result.output : null;
}

function gitOutputResult(ctx: ServerContext, args: string[]): GitCommandResult {
  try {
    const out = execFileSync("git", args, {
      cwd: ctx.projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { ok: true, output: out.length > 0 ? out : "" };
  } catch (error) {
    const code = classifyPRMarkdownRefreshFailureCode(error);
    if (code === "missing_git") return { ok: false, reason: "missing-git" };
    if (code === "not_repo") return { ok: false, reason: "not-a-repo" };
    return { ok: false, reason: "failed" };
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasCommitRef(ctx: ServerContext, ref: string): boolean {
  return gitOutput(ctx, ["rev-parse", "--verify", `${ref}^{commit}`]) !== null;
}

function getPRComparisonRange(ctx: ServerContext): string | null {
  if (hasCommitRef(ctx, "main")) return "main...HEAD";
  if (hasCommitRef(ctx, "origin/main")) return "origin/main...HEAD";
  return null;
}

function getPRMarkdownFileSnapshot(ctx: ServerContext): {
  markdown: string | null;
  signature: string | null;
  generatedAt: string | null;
  cacheStatus: PRMarkdownCacheStatus;
  filePath: string | null;
  fileMtimeMs: number | null;
  mode: PRMarkdownMode;
  confidence?: number;
  coverage?: number;
} {
  const payload = loadPRMarkdownArtifactPayload(ctx);
  for (const fileName of PR_MARKDOWN_FILES) {
    const filePath = join(ctx.svDir, fileName);
    if (!existsSync(filePath)) continue;
    try {
      const markdown = readFileSync(filePath, "utf-8");
      const mtimeMs = statSync(filePath).mtimeMs;
      const generatedAt = Number.isFinite(mtimeMs) && mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null;
      const cacheStatus = Date.now() - mtimeMs > PR_MARKDOWN_STALE_MS ? "stale" : "fresh";
      return {
        markdown,
        signature: digest(markdown),
        generatedAt,
        cacheStatus,
        filePath,
        fileMtimeMs: mtimeMs,
        mode: payload?.mode ?? "normal",
        ...(payload?.mode === "fallback" && payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
        ...(payload?.mode === "fallback" && payload.coverage !== undefined ? { coverage: payload.coverage } : {}),
      };
    } catch {
      return {
        markdown: null,
        signature: null,
        generatedAt: null,
        cacheStatus: "missing",
        filePath,
        fileMtimeMs: null,
        mode: "normal",
      };
    }
  }
  if (payload) {
    const payloadPath = join(ctx.svDir, PR_MARKDOWN_ARTIFACT_PAYLOAD_FILE);
    let mtimeMs: number | null = null;
    try {
      mtimeMs = statSync(payloadPath).mtimeMs;
    } catch {
      mtimeMs = null;
    }
    const generatedAt = mtimeMs !== null && Number.isFinite(mtimeMs) && mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null;
    const cacheStatus = mtimeMs !== null && Number.isFinite(mtimeMs) && Date.now() - mtimeMs > PR_MARKDOWN_STALE_MS
      ? "stale"
      : "fresh";
    return {
      markdown: payload.markdown,
      signature: digest(payload.markdown),
      generatedAt,
      cacheStatus,
      filePath: payloadPath,
      fileMtimeMs: mtimeMs,
      mode: payload.mode,
      ...(payload.mode === "fallback" && payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
      ...(payload.mode === "fallback" && payload.coverage !== undefined ? { coverage: payload.coverage } : {}),
    };
  }
  return {
    markdown: null,
    signature: null,
    generatedAt: null,
    cacheStatus: "missing",
    filePath: null,
    fileMtimeMs: null,
    mode: "normal",
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}


function getPRMarkdownState(
  ctx: ServerContext,
  snapshot: {
    signature: string | null;
    generatedAt: string | null;
    cacheStatus: PRMarkdownCacheStatus;
    mode: PRMarkdownMode;
    confidence?: number;
    coverage?: number;
  },
): PRMarkdownState {
  const repoCheck = gitOutputResult(ctx, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    const availability = repoCheck.reason === "missing-git"
      ? "unsupported"
      : repoCheck.reason === "not-a-repo"
        ? "no-repo"
        : "error";
    const message = repoCheck.reason === "missing-git"
      ? "Git is not available on PATH. Install git and restart SourceVision."
      : repoCheck.reason === "not-a-repo"
        ? "This directory is not a git repository. Open a repository to generate PR markdown."
        : "Git commands failed unexpectedly. Verify repository access and try again.";
    return {
      trackedFilesSignature: null,
      gitStatusSignature: null,
      gitDiffSignature: null,
      signature: availability,
      availability,
      message,
      warning: null,
      baseRange: null,
      cacheStatus: snapshot.cacheStatus,
      generatedAt: snapshot.generatedAt,
      staleAfterMs: PR_MARKDOWN_STALE_MS,
      mode: snapshot.mode,
      ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
      ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
    };
  }
  if (repoCheck.output !== "true") {
    return {
      trackedFilesSignature: null,
      gitStatusSignature: null,
      gitDiffSignature: null,
      signature: "no-repo",
      availability: "no-repo",
      message: "This directory is not a git repository. Open a repository to generate PR markdown.",
      warning: null,
      baseRange: null,
      cacheStatus: snapshot.cacheStatus,
      generatedAt: snapshot.generatedAt,
      staleAfterMs: PR_MARKDOWN_STALE_MS,
      mode: snapshot.mode,
      ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
      ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
    };
  }

  const baseRange = getPRComparisonRange(ctx);
  const warning = baseRange
    ? null
    : "Could not resolve base branch (`main` or `origin/main`). PR markdown generation may be limited.";
  const message = baseRange
    ? null
    : "Repository metadata is available, but PR markdown generation needs a resolvable base branch.";
  const signature = digest(`ready|${snapshot.signature ?? "none"}|${snapshot.cacheStatus}`);

  return {
    trackedFilesSignature: null,
    gitStatusSignature: null,
    gitDiffSignature: null,
    signature,
    availability: "ready",
    message,
    warning,
    baseRange,
    cacheStatus: snapshot.cacheStatus,
    generatedAt: snapshot.generatedAt,
    staleAfterMs: PR_MARKDOWN_STALE_MS,
    mode: snapshot.mode,
    ...(snapshot.mode === "fallback" && snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
    ...(snapshot.mode === "fallback" && snapshot.coverage !== undefined ? { coverage: snapshot.coverage } : {}),
  };
}

/** Handle sourcevision API requests. Returns true if the request was handled. */
export function handleSourcevisionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";
  const queryIdx = url.indexOf("?");
  const routePath = queryIdx === -1 ? url : url.slice(0, queryIdx);
  const query = queryIdx === -1 ? "" : url.slice(queryIdx + 1);

  if (!routePath.startsWith(SV_PREFIX)) return false;

  const path = routePath.slice(SV_PREFIX.length);
  const params = new URLSearchParams(query);

  if (method !== "GET") return false;

  // GET /api/sv/manifest
  if (path === "manifest") {
    const data = loadDataFile(ctx, DATA_FILES.manifest);
    if (!data) {
      errorResponse(res, 404, "No manifest data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/inventory — supports ?offset=N&limit=N for pagination
  if (path === "inventory") {
    const data = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    if (!data) {
      errorResponse(res, 404, "No inventory data. Run 'sourcevision analyze' first.");
      return true;
    }

    // Support pagination via ?offset=N&limit=N query parameters
    const offsetStr = params.get("offset");
    const limitStr = params.get("limit");
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
    const limit = limitStr ? Math.max(0, parseInt(limitStr, 10) || 0) : 0;

    if ((offset > 0 || limit > 0) && Array.isArray(data.files)) {
      const allFiles = data.files as unknown[];
      const total = allFiles.length;
      const slicedFiles = limit > 0
        ? allFiles.slice(offset, offset + limit)
        : allFiles.slice(offset);

      jsonResponse(res, 200, {
        ...data,
        files: slicedFiles,
        pagination: { offset, limit: limit || total - offset, total },
      });
    } else {
      jsonResponse(res, 200, data);
    }
    return true;
  }

  // GET /api/sv/imports
  if (path === "imports") {
    const data = loadDataFile(ctx, DATA_FILES.imports);
    if (!data) {
      errorResponse(res, 404, "No imports data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/zones
  if (path === "zones") {
    const data = loadDataFile(ctx, DATA_FILES.zones);
    if (!data) {
      errorResponse(res, 404, "No zones data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/components
  if (path === "components") {
    const data = loadDataFile(ctx, DATA_FILES.components);
    if (!data) {
      errorResponse(res, 404, "No components data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/callgraph
  if (path === "callgraph") {
    const data = loadDataFile(ctx, DATA_FILES.callGraph);
    if (!data) {
      errorResponse(res, 404, "No call graph data. Run 'sourcevision analyze' first.");
      return true;
    }
    jsonResponse(res, 200, data);
    return true;
  }

  // GET /api/sv/context
  if (path === "context") {
    const text = loadTextFile(ctx, "CONTEXT.md");
    if (!text) {
      errorResponse(res, 404, "No CONTEXT.md. Run 'sourcevision analyze' first.");
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/markdown", "Cache-Control": "no-cache" });
    res.end(text);
    return true;
  }

  // GET /api/sv/pr-markdown
  if (path === "pr-markdown") {
    const snapshot = getPRMarkdownFileSnapshot(ctx);
    const state = getPRMarkdownState(ctx, snapshot);
    const markdown = snapshot.markdown;
    jsonResponse(res, 200, { markdown, ...state });
    return true;
  }

  // GET /api/sv/pr-markdown/state
  if (path === "pr-markdown/state") {
    const snapshot = getPRMarkdownFileSnapshot(ctx);
    jsonResponse(res, 200, getPRMarkdownState(ctx, snapshot));
    return true;
  }

  // GET /api/sv/summary — aggregate stats
  if (path === "summary") {
    const manifest = loadDataFile(ctx, DATA_FILES.manifest) as Record<string, unknown> | null;
    const inventory = loadDataFile(ctx, DATA_FILES.inventory) as Record<string, unknown> | null;
    const zones = loadDataFile(ctx, DATA_FILES.zones) as Record<string, unknown> | null;
    const components = loadDataFile(ctx, DATA_FILES.components) as Record<string, unknown> | null;
    const callGraph = loadDataFile(ctx, DATA_FILES.callGraph) as Record<string, unknown> | null;

    const summary: Record<string, unknown> = {
      hasManifest: !!manifest,
      hasInventory: !!inventory,
      hasZones: !!zones,
      hasComponents: !!components,
      hasCallGraph: !!callGraph,
    };

    if (manifest) {
      summary.project = (manifest as Record<string, unknown>).project;
      summary.analyzedAt = (manifest as Record<string, unknown>).timestamp;
    }

    if (inventory) {
      const inv = inventory as Record<string, unknown>;
      summary.fileCount = Array.isArray(inv.files) ? inv.files.length : 0;
      summary.inventorySummary = inv.summary;
    }

    if (zones) {
      const z = zones as Record<string, unknown>;
      summary.zoneCount = Array.isArray(z.zones) ? z.zones.length : 0;
    }

    if (components) {
      const c = components as Record<string, unknown>;
      summary.componentCount = Array.isArray(c.components) ? c.components.length : 0;
    }

    if (callGraph) {
      const cg = callGraph as Record<string, unknown>;
      summary.callGraphSummary = cg.summary;
    }

    // PR markdown generation status
    const prSnapshot = getPRMarkdownFileSnapshot(ctx);
    summary.prMarkdown = {
      available: prSnapshot.markdown !== null,
      cacheStatus: prSnapshot.cacheStatus,
      generatedAt: prSnapshot.generatedAt,
      mode: prSnapshot.mode,
    };

    jsonResponse(res, 200, summary);
    return true;
  }

  return false;
}
