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
import { invalidateAuthCheckCache } from "./routes-commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

/** Local model config shape returned by GET /api/llm/config. */
export interface LocalVendorConfig {
  model: string | null;
  lightModel: string | null;
  host: string | null;
  port: number | null;
}

/** Shape returned by GET /api/llm/config. */
export interface LlmConfigResponse {
  /** Active LLM vendor: "claude", "codex", "local", or null if unset. */
  vendor: string | null;
  /** Claude-specific settings from llm.claude.* */
  claude: VendorConfig;
  /** Codex-specific settings from llm.codex.* */
  codex: VendorConfig;
  /** Local server settings from llm.local.* */
  local: LocalVendorConfig;
  /**
   * Legacy claude.* settings for display when llm.claude.* are absent.
   * These are read-only — writes go to the modern llm.claude.* namespace.
   */
  legacyClaude: VendorConfig;
  /** Enable automatic failover on model/vendor errors. */
  autoFailover?: boolean;
}

/** Shape expected by PUT /api/llm/config. */
interface LlmConfigPutBody {
  /** Dot-path → string, boolean, number, or null value. */
  changes: Record<string, string | boolean | number | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NDX_CONFIG = ".n-dx.json";
const VALID_VENDORS = new Set(["claude", "codex", "local"]);

/** Writable paths. Auth fields (api_key, api_endpoint, cli_path) are excluded. */
const VALID_PATHS = new Set([
  "llm.vendor",
  "llm.claude.model",
  "llm.claude.lightModel",
  "llm.codex.model",
  "llm.codex.lightModel",
  "llm.local.model",
  "llm.local.lightModel",
  "llm.local.host",
  "llm.local.port",
  "llm.autoFailover",
  "claude.model",
  "claude.lightModel",
]);

/** Paths that accept numeric values (stored as numbers in JSON). */
const NUMERIC_PATHS = new Set(["llm.local.port"]);

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
  const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
  const legacyClaude = (config["claude"] ?? {}) as Record<string, unknown>;

  const result: LlmConfigResponse = {
    vendor: typeof llm["vendor"] === "string" ? llm["vendor"] : null,
    claude: {
      model: getString(llmClaude, "model"),
      lightModel: getString(llmClaude, "lightModel"),
    },
    codex: {
      model: getString(llmCodex, "model"),
      lightModel: getString(llmCodex, "lightModel"),
    },
    local: {
      model: getString(llmLocal, "model"),
      lightModel: getString(llmLocal, "lightModel"),
      host: getString(llmLocal, "host"),
      port: typeof llmLocal["port"] === "number" ? llmLocal["port"] : null,
    },
    legacyClaude: {
      model: getString(legacyClaude, "model"),
      lightModel: getString(legacyClaude, "lightModel"),
    },
  };

  if (typeof llm["autoFailover"] === "boolean") {
    result.autoFailover = llm["autoFailover"];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Local server health probe
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_HOST = "localhost";
const DEFAULT_LOCAL_PORT = 1234;
const LOCAL_HEALTH_TIMEOUT_MS = 3_000;

interface LocalStatusResponse {
  ok: boolean;
  url: string;
  models: string[];
  error?: string;
}

async function probeLocalServer(
  host: string,
  port: number,
): Promise<LocalStatusResponse> {
  const url = `http://${host}:${port}/v1/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOCAL_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, url, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? [])
      .map((m) => (typeof m.id === "string" ? m.id : ""))
      .filter(Boolean);
    return { ok: true, url, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("abort") || msg.includes("Cancel")
      ? "Timed out — is LM Studio running?"
      : msg.includes("ECONNREFUSED")
        ? "Connection refused — check host/port"
        : msg;
    return { ok: false, url, models: [], error: friendly };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Local inference smoke test
// ---------------------------------------------------------------------------

const SMOKE_TEST_TIMEOUT_MS = 30_000; // local models can be slow to first token
const SMOKE_PROMPT = "Reply with only the word OK.";

interface SmokeTestResponse {
  ok: boolean;
  latencyMs: number;
  tokensPerSecond: number | null;
  outputTokens: number | null;
  reply: string | null;
  error?: string;
  url: string;
}

async function runSmokeTest(
  host: string,
  port: number,
  model: string,
): Promise<SmokeTestResponse> {
  const url = `http://${host}:${port}/v1/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SMOKE_TEST_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: SMOKE_PROMPT }],
      max_tokens: 16,
      temperature: 0,
    };
    if (model) body.model = model;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const latencyMs = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, latencyMs, tokensPerSecond: null, outputTokens: null, reply: null, error: `HTTP ${res.status}: ${text.slice(0, 120)}`, url };
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number };
    };

    const reply = data.choices?.[0]?.message?.content?.trim() ?? null;
    const outputTokens = data.usage?.completion_tokens ?? null;
    const tokensPerSecond = outputTokens && latencyMs > 0
      ? Math.round((outputTokens / latencyMs) * 1000 * 10) / 10
      : null;

    return { ok: true, latencyMs, tokensPerSecond, outputTokens, reply, url };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("abort") || msg.includes("Cancel")
      ? `Timed out after ${SMOKE_TEST_TIMEOUT_MS / 1000}s — model may still be loading`
      : msg.includes("ECONNREFUSED")
        ? "Connection refused — is LM Studio running?"
        : msg;
    return { ok: false, latencyMs, tokensPerSecond: null, outputTokens: null, reply: null, error: friendly, url };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Local profiles
// ---------------------------------------------------------------------------

export interface LocalProfile {
  name: string;
  host: string;
  port: number;
  model: string;
}

function readProfiles(projectDir: string): LocalProfile[] {
  const config = readNdxConfig(projectDir);
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const local = (llm["local"] ?? {}) as Record<string, unknown>;
  const raw = local["profiles"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is LocalProfile =>
      typeof p === "object" && p !== null &&
      typeof (p as Record<string, unknown>)["name"] === "string" &&
      typeof (p as Record<string, unknown>)["host"] === "string" &&
      typeof (p as Record<string, unknown>)["port"] === "number",
  ).map((p) => ({
    name: (p as LocalProfile).name,
    host: (p as LocalProfile).host,
    port: (p as LocalProfile).port,
    model: typeof (p as LocalProfile).model === "string" ? (p as LocalProfile).model : "",
  }));
}

function writeProfilesConfig(projectDir: string, profiles: LocalProfile[]): void {
  const config = readNdxConfig(projectDir);
  setByPath(config, "llm.local.profiles", profiles);
  writeNdxConfig(projectDir, config);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const LLM_PREFIX = "/api/llm/config";
const LLM_LOCAL_STATUS = "/api/llm/local-status";
const LLM_LOCAL_TEST = "/api/llm/local-test";
const LLM_LOCAL_PROFILES = "/api/llm/local-profiles";

/** Handle LLM config API requests. Returns true if the request was handled. */
export async function handleLlmRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  // GET /api/llm/local-profiles — list saved local profiles
  if (method === "GET" && url === LLM_LOCAL_PROFILES) {
    jsonResponse(res, 200, { profiles: readProfiles(ctx.projectDir) });
    return true;
  }

  // POST /api/llm/local-profiles — create or update a named profile
  if (method === "POST" && url === LLM_LOCAL_PROFILES) {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body) as Partial<LocalProfile>;
      if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
        errorResponse(res, 400, "Profile 'name' is required");
        return true;
      }
      const profile: LocalProfile = {
        name: data.name.trim(),
        host: typeof data.host === "string" && data.host ? data.host : DEFAULT_LOCAL_HOST,
        port: typeof data.port === "number" && data.port > 0 ? data.port : DEFAULT_LOCAL_PORT,
        model: typeof data.model === "string" ? data.model : "",
      };
      const existing = readProfiles(ctx.projectDir);
      const idx = existing.findIndex((p) => p.name === profile.name);
      const profiles = idx >= 0
        ? existing.map((p, i) => (i === idx ? profile : p))
        : [...existing, profile];
      writeProfilesConfig(ctx.projectDir, profiles);
      jsonResponse(res, 200, { profiles });
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
    }
    return true;
  }

  // DELETE /api/llm/local-profiles?name=... — remove a named profile
  if (method === "DELETE" && url.startsWith(LLM_LOCAL_PROFILES)) {
    const parsedUrl = new URL(url, "http://localhost");
    const name = parsedUrl.searchParams.get("name");
    if (!name) {
      errorResponse(res, 400, "Query param 'name' is required");
      return true;
    }
    const profiles = readProfiles(ctx.projectDir).filter((p) => p.name !== name);
    writeProfilesConfig(ctx.projectDir, profiles);
    jsonResponse(res, 200, { profiles });
    return true;
  }

  // POST /api/llm/local-test — run a real inference smoke test.
  // Optional JSON body: { host?, port?, model? } — overrides saved config so
  // the client can test unsaved edit values without saving first.
  if (method === "POST" && url === LLM_LOCAL_TEST) {
    const config = readNdxConfig(ctx.projectDir);
    const llm = (config["llm"] ?? {}) as Record<string, unknown>;
    const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
    // Saved config defaults
    let host = typeof llmLocal["host"] === "string" && llmLocal["host"]
      ? llmLocal["host"] : DEFAULT_LOCAL_HOST;
    let port = typeof llmLocal["port"] === "number" && llmLocal["port"] > 0
      ? llmLocal["port"] : DEFAULT_LOCAL_PORT;
    let model = typeof llmLocal["model"] === "string" ? llmLocal["model"] : "";
    // Allow body overrides for unsaved edit values
    try {
      const rawBody = await readBody(req);
      if (rawBody.trim()) {
        const body = JSON.parse(rawBody) as Partial<{ host: string; port: number; model: string }>;
        if (typeof body.host === "string" && body.host) host = body.host;
        if (typeof body.port === "number" && body.port > 0) port = body.port;
        if (typeof body.model === "string") model = body.model;
      }
    } catch {
      // Body is optional — malformed JSON falls back to saved config
    }
    const result = await runSmokeTest(host, port, model);
    jsonResponse(res, 200, result);
    return true;
  }

  // GET /api/llm/local-status — probe the configured local LLM server
  if (method === "GET" && url === LLM_LOCAL_STATUS) {
    const config = readNdxConfig(ctx.projectDir);
    const llm = (config["llm"] ?? {}) as Record<string, unknown>;
    const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
    const host = typeof llmLocal["host"] === "string" && llmLocal["host"]
      ? llmLocal["host"]
      : DEFAULT_LOCAL_HOST;
    const port = typeof llmLocal["port"] === "number" && llmLocal["port"] > 0
      ? llmLocal["port"]
      : DEFAULT_LOCAL_PORT;
    const result = await probeLocalServer(host, port);
    jsonResponse(res, 200, result);
    return true;
  }

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
        if (path === "llm.autoFailover") {
          if (value !== null && typeof value !== "boolean") {
            errorResponse(res, 400, `Value for "${path}" must be a boolean or null, got ${typeof value}`);
            return true;
          }
        } else if (NUMERIC_PATHS.has(path)) {
          // Accept a number, or a numeric string that we'll coerce to a number
          if (value !== null && typeof value !== "number" && typeof value !== "string") {
            errorResponse(res, 400, `Value for "${path}" must be a number or null, got ${typeof value}`);
            return true;
          }
          if (value !== null) {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 65535) {
              errorResponse(res, 400, `Value for "${path}" must be a valid port number (1–65535), got ${JSON.stringify(value)}`);
              return true;
            }
          }
        } else {
          if (value !== null && typeof value !== "string") {
            errorResponse(res, 400, `Value for "${path}" must be a string or null, got ${typeof value}`);
            return true;
          }
        }
        if (path === "llm.vendor" && value !== null && !VALID_VENDORS.has(value.toString())) {
          errorResponse(res, 400, `llm.vendor must be one of: ${[...VALID_VENDORS].join(", ")}; got "${value}"`);
          return true;
        }
      }

      const config = readNdxConfig(ctx.projectDir);
      const applied: string[] = [];

      for (const [path, value] of Object.entries(parsed.changes)) {
        if (value === null || value === "") {
          deleteByPath(config, path);
        } else if (NUMERIC_PATHS.has(path)) {
          // Coerce string port values to numbers before persisting
          setByPath(config, path, Number(value));
        } else {
          setByPath(config, path, value);
        }
        applied.push(path);
      }

      writeNdxConfig(ctx.projectDir, config);
      // The credential check's answer depends on this config — drop the
      // cached result so the auth chip re-verifies against the new settings.
      invalidateAuthCheckCache();
      jsonResponse(res, 200, { applied, config: extractLlmConfig(ctx.projectDir) });
      return true;
    } catch (err) {
      errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
      return true;
    }
  }

  return false;
}
