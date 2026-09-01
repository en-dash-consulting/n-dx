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
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { LLM_VENDOR } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import {jsonResponse} from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NdxConfigSummary {
  /** Active LLM vendor: "claude", "codex", "local", or null if unset. */
  vendor: string | null;
  /** Active model for the current vendor (from llm.<vendor>.model or legacy claude.model). */
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
async function extractConfig(ctx: ServerContext): Promise<NdxConfigSummary> {
  const henchConfigPath = join(ctx.projectDir, ".hench", "config.json");
  const ndxConfigPath = join(ctx.projectDir, ".n-dx.json");
  const pkgPath = join(ctx.projectDir, "package.json");

  const henchConfig = readJSON(henchConfigPath);
  const ndxConfig = readJSON(ndxConfigPath);
  const pkgJson = readJSON(pkgPath);

  // Vendor and model from modern llm.* namespace
  const llmConfig = ndxConfig?.llm && typeof ndxConfig.llm === "object"
    ? ndxConfig.llm as Record<string, unknown>
    : null;
  const vendor = llmConfig && typeof llmConfig.vendor === "string" ? llmConfig.vendor : null;

  // Model: read from active vendor's llm.<vendor>.model field
  let model: string | null = null;
  if (vendor && llmConfig) {
    const vendorCfg = llmConfig[vendor];
    if (vendorCfg && typeof vendorCfg === "object") {
      const vm = (vendorCfg as Record<string, unknown>).model;
      if (typeof vm === "string" && vm.length > 0) model = vm;
    }
  }
  // Legacy fallback: claude.model or hench.model (used before llm.* namespace existed)
  if (!model) {
    const legacyModel = ndxConfig?.claude &&
      typeof ndxConfig.claude === "object"
      ? (ndxConfig.claude as Record<string, unknown>).model
      : undefined;
    const henchModel = henchConfig?.model;
    model = (typeof legacyModel === "string" && legacyModel.length > 0 ? legacyModel : null) ??
            (typeof henchModel === "string" && henchModel.length > 0 ? henchModel : null);
  }

  // For local vendor: query LM Studio for the currently loaded model.
  // If the live model differs from the stored config, write it back to .n-dx.json
  // so the displayed name stays in sync without requiring ndx init.
  if (vendor === LLM_VENDOR.LOCAL && llmConfig) {
    const localCfg = llmConfig.local && typeof llmConfig.local === "object"
      ? llmConfig.local as Record<string, unknown>
      : {};
    const host = typeof localCfg.host === "string" ? localCfg.host : "localhost";
    const port = typeof localCfg.port === "number" ? localCfg.port : 1234;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://${host}:${port}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json() as { data?: Array<{ id: string }> };
        const liveModel = data.data?.[0]?.id ?? null;
        if (liveModel && liveModel !== model) {
          // Persist live model back to .n-dx.json so config stays current
          try {
            const updated: Record<string, unknown> = ndxConfig ? { ...ndxConfig } : {};
            if (!updated.llm || typeof updated.llm !== "object") {
              updated.llm = { vendor: LLM_VENDOR.LOCAL };
            }
            const llm = updated.llm as Record<string, unknown>;
            if (!llm.local || typeof llm.local !== "object") {
              llm.local = {};
            }
            (llm.local as Record<string, unknown>).model = liveModel;
            writeFileSync(ndxConfigPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
            // Invalidate cache so next request re-reads from disk
            configCache = null;
          } catch {
            // Write failure is non-fatal — still return the live model
          }
          model = liveModel;
        } else if (liveModel) {
          model = liveModel;
        }
      }
    } catch {
      // LM Studio not reachable — use stored config value
    }
  }

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
  } else if (vendor === LLM_VENDOR.LOCAL || vendor === LLM_VENDOR.GOOGLE) {
    // Local (LM Studio/Ollama) and Google use a REST API — no CLI or API key needed.
    // Treat as "api-key" so the footer shows ✓ rather than ⚠.
    authMethod = "api-key";
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
    vendor,
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
  // Strip the query string — a trailing "?_=1" cache-buster (or any future
  // query param) must not fall through this exact-equality match to a 404.
  const url = (req.url || "/").split("?")[0];
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

    const config = await extractConfig(ctx);
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
