/**
 * Configuration display and project switching API routes.
 *
 * Reads n-dx configuration from .hench/config.json and .n-dx.json to display
 * active settings in the dashboard footer. Scans for sibling/parent n-dx
 * projects to enable project switching.
 *
 * GET /api/ndx-config     — active project configuration summary
 * GET /api/projects       — detected n-dx projects for switching
 * POST /api/projects/switch — switch to a different project directory
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NdxConfigSummary {
  /** Active Claude model (from hench config or .n-dx.json). */
  model: string | null;
  /** Provider type: "cli" or "api". */
  provider: string | null;
  /** Authentication method detected: "api-key", "cli", or "none". */
  authMethod: "api-key" | "cli" | "none";
  /** Token budget per run (0 or null = unlimited). */
  tokenBudget: number | null;
  /** Max turns per run. */
  maxTurns: number | null;
  /** Project directory path. */
  projectDir: string;
  /** Project name (from package.json or directory basename). */
  projectName: string;
}

export interface DetectedProject {
  /** Absolute path to the project directory. */
  path: string;
  /** Project name (from package.json or directory name). */
  name: string;
  /** Whether this is the currently active project. */
  active: boolean;
  /** Which n-dx tools are initialized. */
  tools: {
    sourcevision: boolean;
    rex: boolean;
    hench: boolean;
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ConfigCache {
  config: NdxConfigSummary;
  timestamp: number;
  projectDir: string;
}

interface ProjectsCache {
  projects: DetectedProject[];
  timestamp: number;
  projectDir: string;
}

/** Config cache TTL — 10 seconds. */
const CONFIG_CACHE_TTL_MS = 10_000;

/** Projects cache TTL — 30 seconds (directory scanning is heavier). */
const PROJECTS_CACHE_TTL_MS = 30_000;

let configCache: ConfigCache | null = null;
let projectsCache: ProjectsCache | null = null;

/** Clear caches (exposed for testing). */
export function clearConfigCaches(): void {
  configCache = null;
  projectsCache = null;
}

// ---------------------------------------------------------------------------
// Config extraction
// ---------------------------------------------------------------------------

/** Read and parse a JSON file, returning null on failure. */
function readJSON(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Extract configuration summary from project files. */
function extractConfig(ctx: ServerContext): NdxConfigSummary {
  const henchConfigPath = join(ctx.projectDir, ".hench", "config.json");
  const ndxConfigPath = join(ctx.projectDir, ".n-dx.json");
  const pkgPath = join(ctx.projectDir, "package.json");

  const henchConfig = readJSON(henchConfigPath);
  const ndxConfig = readJSON(ndxConfigPath);
  const pkgJson = readJSON(pkgPath);

  // Model: prefer .n-dx.json claude.model, fallback to hench config
  const claudeModel = ndxConfig?.claude &&
    typeof ndxConfig.claude === "object" &&
    (ndxConfig.claude as Record<string, unknown>).model;
  const henchModel = henchConfig?.model;
  const model = (typeof claudeModel === "string" ? claudeModel : null) ??
    (typeof henchModel === "string" ? henchModel : null);

  // Provider
  const provider = typeof henchConfig?.provider === "string"
    ? henchConfig.provider
    : null;

  // Auth method detection
  const hasApiKey = ndxConfig?.claude &&
    typeof ndxConfig.claude === "object" &&
    typeof (ndxConfig.claude as Record<string, unknown>).api_key === "string" &&
    ((ndxConfig.claude as Record<string, unknown>).api_key as string).length > 0;
  const hasCliPath = ndxConfig?.claude &&
    typeof ndxConfig.claude === "object" &&
    typeof (ndxConfig.claude as Record<string, unknown>).cli_path === "string" &&
    ((ndxConfig.claude as Record<string, unknown>).cli_path as string).length > 0;

  let authMethod: "api-key" | "cli" | "none" = "none";
  if (hasApiKey) {
    authMethod = "api-key";
  } else if (provider === "cli" || hasCliPath) {
    authMethod = "cli";
  }

  // Token budget
  const tokenBudget = typeof henchConfig?.tokenBudget === "number"
    ? henchConfig.tokenBudget
    : null;

  // Max turns
  const maxTurns = typeof henchConfig?.maxTurns === "number"
    ? henchConfig.maxTurns
    : null;

  // Project name
  const pkgName = typeof pkgJson?.name === "string" ? pkgJson.name : null;
  const projectName = pkgName ?? basename(ctx.projectDir);

  return {
    model,
    provider,
    authMethod,
    tokenBudget,
    maxTurns,
    projectDir: ctx.projectDir,
    projectName,
  };
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

/** Check if a directory looks like an n-dx project. */
function detectNdxProject(dirPath: string, activeDir: string): DetectedProject | null {
  try {
    const s = statSync(dirPath);
    if (!s.isDirectory()) return null;
  } catch {
    return null;
  }

  const hasSv = existsSync(join(dirPath, ".sourcevision"));
  const hasRex = existsSync(join(dirPath, ".rex"));
  const hasHench = existsSync(join(dirPath, ".hench"));
  const hasNdxJson = existsSync(join(dirPath, ".n-dx.json"));

  // Must have at least one n-dx marker
  if (!hasSv && !hasRex && !hasHench && !hasNdxJson) return null;

  // Get project name from package.json or directory name
  const pkgJson = readJSON(join(dirPath, "package.json"));
  const name = (typeof pkgJson?.name === "string" ? pkgJson.name : null) ?? basename(dirPath);

  return {
    path: dirPath,
    name,
    active: resolve(dirPath) === resolve(activeDir),
    tools: {
      sourcevision: hasSv,
      rex: hasRex,
      hench: hasHench,
    },
  };
}

/** Scan parent and sibling directories for n-dx projects. */
function detectProjects(ctx: ServerContext): DetectedProject[] {
  const projects: DetectedProject[] = [];
  const seen = new Set<string>();

  // Always include the active project
  const activeProject = detectNdxProject(ctx.projectDir, ctx.projectDir);
  if (activeProject) {
    projects.push(activeProject);
    seen.add(resolve(ctx.projectDir));
  }

  // Scan parent directory for sibling projects
  const parentDir = dirname(ctx.projectDir);
  try {
    const siblings = readdirSync(parentDir, { withFileTypes: true });
    for (const entry of siblings) {
      if (!entry.isDirectory()) continue;
      // Skip hidden directories and node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const siblingPath = join(parentDir, entry.name);
      const resolved = resolve(siblingPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      const project = detectNdxProject(siblingPath, ctx.projectDir);
      if (project) {
        projects.push(project);
      }
    }
  } catch {
    // Parent directory not readable — skip
  }

  // Check parent directory itself (for monorepo cases)
  const parentResolved = resolve(parentDir);
  if (!seen.has(parentResolved)) {
    seen.add(parentResolved);
    const parentProject = detectNdxProject(parentDir, ctx.projectDir);
    if (parentProject) {
      projects.push(parentProject);
    }
  }

  // Sort: active first, then alphabetically by name
  projects.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return a.name.localeCompare(b.name);
  });

  return projects;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const CONFIG_PREFIX = "/api/ndx-config";
const PROJECTS_PREFIX = "/api/projects";

/** Handle config/project API requests. Returns true if the request was handled. */
export async function handleConfigRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/ndx-config — configuration summary
  if (method === "GET" && url === CONFIG_PREFIX) {
    const now = Date.now();
    if (
      configCache &&
      configCache.projectDir === ctx.projectDir &&
      now - configCache.timestamp < CONFIG_CACHE_TTL_MS
    ) {
      jsonResponse(res, 200, configCache.config);
      return true;
    }

    const config = extractConfig(ctx);
    configCache = { config, projectDir: ctx.projectDir, timestamp: now };
    jsonResponse(res, 200, config);
    return true;
  }

  // GET /api/projects — detected projects
  if (method === "GET" && url === PROJECTS_PREFIX) {
    const now = Date.now();
    if (
      projectsCache &&
      projectsCache.projectDir === ctx.projectDir &&
      now - projectsCache.timestamp < PROJECTS_CACHE_TTL_MS
    ) {
      jsonResponse(res, 200, projectsCache.projects);
      return true;
    }

    const projects = detectProjects(ctx);
    projectsCache = { projects, projectDir: ctx.projectDir, timestamp: now };
    jsonResponse(res, 200, projects);
    return true;
  }

  return false;
}
