/**
 * Configuration display API route.
 *
 * Reads n-dx configuration from .hench/config.json and .n-dx.json to display
 * active settings in the dashboard footer.
 *
 * GET /api/ndx-config     — active project configuration summary
 *
 * The sibling-directory project scan that used to live here (`GET
 * /api/projects`) was retired in 0.6.0: worktrees of the served repository
 * are reported by `GET /api/worktrees` (routes-worktrees.ts), and switching
 * between unrelated projects is the 0.7.0 hub registry's job.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { LLM_VENDOR } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { WorkspaceScoped } from "./workspace-scoped.js";
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

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ConfigCache {
  config: NdxConfigSummary;
  timestamp: number;
  projectDir: string;
}

/** Config cache TTL — 10 seconds. */
const CONFIG_CACHE_TTL_MS = 10_000;

/** One cache slot per workspace. */
const configCaches = new WorkspaceScoped<{ entry: ConfigCache | null }>(() => ({ entry: null }));

/** Clear caches for every workspace (exposed for testing). */
export function clearConfigCaches(): void {
  configCaches.clear();
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

/** Deep-merge the local config layer over the shared one; objects recurse, everything else is replaced. */
function mergeConfigLayers(
  shared: Record<string, unknown> | null,
  local: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!shared) return local;
  if (!local) return shared;
  const out: Record<string, unknown> = { ...shared };
  for (const [key, value] of Object.entries(local)) {
    const existing = out[key];
    if (
      value && typeof value === "object" && !Array.isArray(value)
      && existing && typeof existing === "object" && !Array.isArray(existing)
    ) {
      out[key] = mergeConfigLayers(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Extract configuration summary from project files. */
async function extractConfig(ctx: ServerContext): Promise<NdxConfigSummary> {
  const henchConfigPath = join(ctx.projectDir, ".hench", "config.json");
  const ndxConfigPath = join(ctx.projectDir, ".n-dx.json");
  const ndxLocalConfigPath = join(ctx.projectDir, ".n-dx.local.json");
  const pkgPath = join(ctx.projectDir, "package.json");

  const henchConfig = readJSON(henchConfigPath);
  // `ndx config` writes api_key and cli_path to the gitignored .n-dx.local.json,
  // so the auth-method detection below must see the merged view or the footer
  // reports "none" for a perfectly configured project. Local wins, as in
  // every other reader (core config.js, @n-dx/llm-client).
  const ndxConfig = mergeConfigLayers(readJSON(ndxConfigPath), readJSON(ndxLocalConfigPath));
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
          // Persist live model back to .n-dx.json so config stays current.
          // Start from the shared file on disk, not the merged view: the
          // merge carries .n-dx.local.json values (api_key, cli_path) that
          // must never be copied into the committed file.
          try {
            const updated: Record<string, unknown> = readJSON(ndxConfigPath) ?? {};
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
            configCaches.clear();
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
// Route handler
// ---------------------------------------------------------------------------

const CONFIG_PREFIX = "/api/ndx-config";

/** Handle config API requests. Returns true if the request was handled. */
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
    const slot = configCaches.get(ctx);
    if (slot.entry && slot.entry.projectDir === ctx.projectDir && now - slot.entry.timestamp < CONFIG_CACHE_TTL_MS) {
      jsonResponse(res, 200, slot.entry.config);
      return true;
    }

    const config = await extractConfig(ctx);
    slot.entry = { config, projectDir: ctx.projectDir, timestamp: now };
    jsonResponse(res, 200, config);
    return true;
  }

  return false;
}
