/**
 * LLM provider configuration API routes.
 *
 * Reads and writes LLM provider settings from `.n-dx.json` under the
 * `llm` key (modern namespace) and `claude` key (legacy namespace).
 * Auth-sensitive fields (api_key, api_endpoint, cli_path) are omitted
 * from the response; only vendor selection and model names are exposed.
 *
 * GET /api/llm/config   — current LLM provider configuration
 * PUT /api/llm/config   — update LLM provider configuration
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

/** Shape returned by GET /api/llm/config. */
export interface LlmConfigResponse {
  /** Active LLM vendor: "claude", "codex", or null if unset. */
  vendor: string | null;
  /** Claude-specific settings from llm.claude.* */
  claude: VendorConfig;
  /** Codex-specific settings from llm.codex.* */
  codex: VendorConfig;
  /**
   * Legacy claude.* settings for display when llm.claude.* are absent.
   * These are read-only — writes go to the modern llm.claude.* namespace.
   */
  legacyClaude: VendorConfig;
}

/** Shape expected by PUT /api/llm/config. */
interface LlmConfigPutBody {
  /** Dot-path → string value (or null to delete). */
  changes: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NDX_CONFIG = ".n-dx.json";
const VALID_VENDORS = new Set(["claude", "codex"]);

/** Writable paths. Auth fields (api_key, api_endpoint, cli_path) are excluded. */
const VALID_PATHS = new Set([
  "llm.vendor",
  "llm.claude.model",
  "llm.claude.lightModel",
  "llm.codex.model",
  "llm.codex.lightModel",
  "claude.model",
  "claude.lightModel",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNdxConfig(projectDir: string): Record<string, unknown> {
  const configPath = join(projectDir, NDX_CONFIG);
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeNdxConfig(projectDir: string, config: Record<string, unknown>): void {
  const configPath = join(projectDir, NDX_CONFIG);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Read a string leaf from a nested object. Returns null if absent or not a string. */
function getString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Set a nested value by dot-separated path, creating intermediate objects. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Delete a nested key by dot-separated path. */
function deleteByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current == null || typeof current !== "object") return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (current != null && typeof current === "object") {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]];
  }
}

function extractLlmConfig(projectDir: string): LlmConfigResponse {
  const config = readNdxConfig(projectDir);
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const llmClaude = (llm["claude"] ?? {}) as Record<string, unknown>;
  const llmCodex = (llm["codex"] ?? {}) as Record<string, unknown>;
  const legacyClaude = (config["claude"] ?? {}) as Record<string, unknown>;

  return {
    vendor: typeof llm["vendor"] === "string" ? llm["vendor"] : null,
    claude: {
      model: getString(llmClaude, "model"),
      lightModel: getString(llmClaude, "lightModel"),
    },
    codex: {
      model: getString(llmCodex, "model"),
      lightModel: getString(llmCodex, "lightModel"),
    },
    legacyClaude: {
      model: getString(legacyClaude, "model"),
      lightModel: getString(legacyClaude, "lightModel"),
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const LLM_PREFIX = "/api/llm/config";

/** Handle LLM config API requests. Returns true if the request was handled. */
export async function handleLlmRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/llm/config
  if (method === "GET" && url === LLM_PREFIX) {
    jsonResponse(res, 200, extractLlmConfig(ctx.projectDir));
    return true;
  }

  // PUT /api/llm/config
  if (method === "PUT" && url === LLM_PREFIX) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as LlmConfigPutBody;

      if (!parsed.changes || typeof parsed.changes !== "object") {
        errorResponse(res, 400, "Request body must include a 'changes' object");
        return true;
      }

      for (const [path, value] of Object.entries(parsed.changes)) {
        if (!VALID_PATHS.has(path)) {
          errorResponse(res, 400, `Unknown LLM config path: "${path}". Valid paths: ${[...VALID_PATHS].join(", ")}`);
          return true;
        }
        if (value !== null && typeof value !== "string") {
          errorResponse(res, 400, `Value for "${path}" must be a string or null, got ${typeof value}`);
          return true;
        }
        if (path === "llm.vendor" && value !== null && !VALID_VENDORS.has(value)) {
          errorResponse(res, 400, `llm.vendor must be "claude" or "codex", got "${value}"`);
          return true;
        }
      }

      const config = readNdxConfig(ctx.projectDir);
      const applied: string[] = [];

      for (const [path, value] of Object.entries(parsed.changes)) {
        if (value === null || value === "") {
          deleteByPath(config, path);
        } else {
          setByPath(config, path, value);
        }
        applied.push(path);
      }

      writeNdxConfig(ctx.projectDir, config);
      jsonResponse(res, 200, { applied, config: extractLlmConfig(ctx.projectDir) });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
