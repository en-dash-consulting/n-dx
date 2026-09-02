/**
 * LLM provider configuration API routes.
 *
 * Reads and writes LLM provider settings from `.n-dx.json` under the
 * `llm` key (modern namespace) and `claude` key (legacy namespace), merged
 * with `.n-dx.local.json` (local wins) for reads — the same "local wins"
 * overlay `packages/core/config.js` and `@n-dx/llm-client`'s config loader
 * apply, so a per-machine override in the gitignored local file is reflected
 * here too. Writes still go to the shared `.n-dx.json` only.
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
import { LLM_VENDOR, deepMerge } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

/** Second-model verifier config, nested under `local`. */
export interface LocalVerifierVendorConfig {
  host: string | null;
  port: number | null;
  model: string | null;
  maxCycles: number | null;
}

/** Local model config shape returned by GET /api/llm/config. */
export interface LocalVendorConfig {
  model: string | null;
  lightModel: string | null;
  host: string | null;
  port: number | null;
  /** Max context window (tokens) hench pre-checks a brief against before sending. */
  maxContextTokens: number | null;
  /** Second-model review pass config. All fields null when unset. */
  verifier: LocalVerifierVendorConfig;
}

/** Shape returned by GET /api/llm/config. */
export interface LlmConfigResponse {
  /** Active LLM vendor: "claude", "codex", "google", "local", or null if unset. */
  vendor: string | null;
  /** Claude-specific settings from llm.claude.* */
  claude: VendorConfig;
  /** Codex-specific settings from llm.codex.* */
  codex: VendorConfig;
  /** Google Gemini settings from llm.google.* */
  google: VendorConfig;
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
const NDX_LOCAL_CONFIG = ".n-dx.local.json";
const VALID_VENDORS: ReadonlySet<string> = new Set([
  LLM_VENDOR.CLAUDE,
  LLM_VENDOR.CODEX,
  LLM_VENDOR.GOOGLE,
  LLM_VENDOR.LOCAL,
]);

/** Writable paths. Auth fields (api_key, api_endpoint, cli_path) are excluded. */
const VALID_PATHS = new Set([
  "llm.vendor",
  // Standard-tier shorthand for the active vendor. Was writable via the CLI
  // but absent here, so the dashboard could not see or set the field with the
  // highest precedence over the model actually used.
  "llm.model",
  "llm.claude.model",
  "llm.claude.lightModel",
  "llm.codex.model",
  "llm.codex.lightModel",
  "llm.google.model",
  "llm.google.lightModel",
  "llm.local.model",
  "llm.local.lightModel",
  "llm.local.host",
  "llm.local.port",
  "llm.local.maxContextTokens",
  "llm.local.verifier.host",
  "llm.local.verifier.port",
  "llm.local.verifier.model",
  "llm.local.verifier.maxCycles",
  "llm.autoFailover",
  "llm.escalation.enabled",
  "llm.escalation.maxSteps",
  "claude.model",
  "claude.lightModel",
]);

/** Routing tiers a `llm.routes.<class>` value may name. */
const TASK_TIERS: ReadonlySet<string> = new Set(["light", "standard", "heavy", "free"]);

/** Effort levels a `llm.effort.<class>` value may name. */
const EFFORT_LEVELS: ReadonlySet<string> = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * Path families whose trailing segments are variable, so they cannot be
 * enumerated in {@link VALID_PATHS}: `llm.tiers.<vendor>.<tier>`,
 * `llm.routes.<class>`, and `llm.effort.<class>`.
 */
const PARAMETERIZED_PREFIXES = ["llm.tiers.", "llm.routes.", "llm.effort."] as const;

/**
 * Sections holding a flat map keyed by task class.
 *
 * Task classes contain dots (`agent.execute`), and so does the path syntax, so
 * these paths must set one literal key rather than nesting — nested config is
 * silently ignored by the flat-map extractor in `loadLLMConfig`, which would
 * make the write appear to succeed and do nothing.
 */
const FLAT_MAP_PREFIXES = ["llm.routes.", "llm.effort."] as const;

function isWritablePath(path: string): boolean {
  if (VALID_PATHS.has(path)) return true;
  return PARAMETERIZED_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length,
  );
}

/** Split a path into object keys, keeping flat-map task classes intact. */
function splitConfigPath(path: string): string[] {
  for (const prefix of FLAT_MAP_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      return [...prefix.slice(0, -1).split("."), path.slice(prefix.length)];
    }
  }
  return path.split(".");
}

/**
 * Reject a parameterized path or value the resolver could not honor.
 * Returns an error message, or null when the change is acceptable.
 */
function validateRoutingChange(path: string, value: unknown): string | null {
  if (path.startsWith("llm.tiers.")) {
    const rest = path.slice("llm.tiers.".length);
    const segments = rest.split(".");
    if (segments.length !== 2) {
      return `Invalid path "${path}". Expected llm.tiers.<vendor>.<tier>.`;
    }
    const [vendor, tier] = segments;
    if (!VALID_VENDORS.has(vendor)) {
      return `Unknown vendor "${vendor}" in "${path}". Expected one of: ${[...VALID_VENDORS].join(", ")}.`;
    }
    if (!TASK_TIERS.has(tier)) {
      return `Unknown tier "${tier}" in "${path}". Expected one of: ${[...TASK_TIERS].join(", ")}.`;
    }
    if (typeof value !== "string" || !value.trim()) {
      return `Value for "${path}" must be a non-empty model ID.`;
    }
    return null;
  }

  if (path.startsWith("llm.routes.")) {
    if (typeof value !== "string" || !TASK_TIERS.has(value)) {
      return `Value for "${path}" must be one of: ${[...TASK_TIERS].join(", ")}; got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  if (path.startsWith("llm.effort.")) {
    if (typeof value !== "string" || !EFFORT_LEVELS.has(value)) {
      return `Value for "${path}" must be one of: ${[...EFFORT_LEVELS].join(", ")}; got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  if (path === "llm.escalation.maxSteps") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      return `Value for "${path}" must be a non-negative integer, got ${JSON.stringify(value)}.`;
    }
    return null;
  }

  return null;
}

/** Paths that accept numeric values (stored as numbers in JSON). */
const NUMERIC_PATHS = new Set([
  "llm.local.port",
  "llm.local.maxContextTokens",
  "llm.local.verifier.port",
  "llm.local.verifier.maxCycles",
  "llm.escalation.maxSteps",
]);

/** Numeric paths validated as a TCP port (1–65535) rather than a plain positive integer. */
const PORT_PATHS = new Set(["llm.local.port", "llm.local.verifier.port"]);

/** Paths that accept boolean values. */
const BOOLEAN_PATHS = new Set(["llm.autoFailover", "llm.escalation.enabled"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/** Read the shared, git-tracked `.n-dx.json` only. Writes always target this file. */
function readNdxConfig(projectDir: string): Record<string, unknown> {
  return readJsonFile(join(projectDir, NDX_CONFIG));
}

/**
 * Read the shared config deep-merged with the gitignored `.n-dx.local.json`
 * overlay (local wins) — the same merge `core/config.js`'s
 * `loadEffectiveProjectConfig` and `@n-dx/llm-client`'s config loader apply.
 * Use this for anything the user should *see* (GET responses, status
 * probes); use `readNdxConfig` for anything about to be *written back*, so a
 * write never flattens the local overlay's values into the shared file.
 */
function readEffectiveNdxConfig(projectDir: string): Record<string, unknown> {
  const shared = readNdxConfig(projectDir);
  const local = readJsonFile(join(projectDir, NDX_LOCAL_CONFIG));
  if (Object.keys(local).length === 0) return shared;
  return deepMerge(shared, local);
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

/** Read a numeric leaf from a nested object. Returns null if absent or not a number. */
function getNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

/** Set a nested value by dot-separated path, creating intermediate objects. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = splitConfigPath(path);
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
  const parts = splitConfigPath(path);
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
  const config = readEffectiveNdxConfig(projectDir);
  const llm = (config["llm"] ?? {}) as Record<string, unknown>;
  const llmClaude = (llm["claude"] ?? {}) as Record<string, unknown>;
  const llmCodex = (llm["codex"] ?? {}) as Record<string, unknown>;
  const llmGoogle = (llm["google"] ?? {}) as Record<string, unknown>;
  const llmLocal = (llm["local"] ?? {}) as Record<string, unknown>;
  const llmLocalVerifier = (llmLocal["verifier"] ?? {}) as Record<string, unknown>;
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
    google: {
      model: getString(llmGoogle, "model"),
      lightModel: getString(llmGoogle, "lightModel"),
    },
    local: {
      model: getString(llmLocal, "model"),
      lightModel: getString(llmLocal, "lightModel"),
      host: getString(llmLocal, "host"),
      port: getNumber(llmLocal, "port"),
      maxContextTokens: getNumber(llmLocal, "maxContextTokens"),
      verifier: {
        host: getString(llmLocalVerifier, "host"),
        port: getNumber(llmLocalVerifier, "port"),
        model: getString(llmLocalVerifier, "model"),
        maxCycles: getNumber(llmLocalVerifier, "maxCycles"),
      },
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

/**
 * Detect a refused TCP connection from a failed `fetch()`.
 *
 * Node's native `fetch` (undici) never puts "ECONNREFUSED" in `err.message` —
 * a refused connection surfaces as `TypeError: fetch failed`, with the real
 * code nested in `err.cause.code` (or, for a dual-stack connect attempt,
 * inside an AggregateError's `err.cause.errors[]`). Checking `err.message`
 * alone (the previous implementation) could never match the single most
 * common failure here: the local server just isn't running yet.
 */
function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.includes("ECONNREFUSED")) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    if ((cause as { code?: unknown }).code === "ECONNREFUSED") return true;
    const nested = (cause as { errors?: unknown }).errors;
    if (Array.isArray(nested)) {
      return nested.some(
        (e) => e && typeof e === "object" && (e as { code?: unknown }).code === "ECONNREFUSED",
      );
    }
  }
  return false;
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
      : isConnectionRefused(err)
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
      : isConnectionRefused(err)
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
  // Query-string-free form for exact-equality route matching below — `url`
  // itself is kept intact because the DELETE branch further down still needs
  // its query string (?name=...) to reach `new URL(url, ...)`.
  const pathname = url.split("?")[0];

  // GET /api/llm/local-profiles — list saved local profiles
  if (method === "GET" && pathname === LLM_LOCAL_PROFILES) {
    jsonResponse(res, 200, { profiles: readProfiles(ctx.projectDir) });
    return true;
  }

  // POST /api/llm/local-profiles — create or update a named profile
  if (method === "POST" && pathname === LLM_LOCAL_PROFILES) {
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
  if (method === "POST" && pathname === LLM_LOCAL_TEST) {
    const config = readEffectiveNdxConfig(ctx.projectDir);
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
  if (method === "GET" && pathname === LLM_LOCAL_STATUS) {
    const config = readEffectiveNdxConfig(ctx.projectDir);
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
  if (method === "GET" && pathname === LLM_PREFIX) {
    jsonResponse(res, 200, extractLlmConfig(ctx.projectDir));
    return true;
  }

  // PUT /api/llm/config
  if (method === "PUT" && pathname === LLM_PREFIX) {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body) as LlmConfigPutBody;

      if (!parsed.changes || typeof parsed.changes !== "object") {
        errorResponse(res, 400, "Request body must include a 'changes' object");
        return true;
      }

      for (const [path, value] of Object.entries(parsed.changes)) {
        if (!isWritablePath(path)) {
          errorResponse(res, 400, `Unknown LLM config path: "${path}". Valid paths: ${[...VALID_PATHS].join(", ")}, or llm.tiers.<vendor>.<tier> / llm.routes.<class> / llm.effort.<class>`);
          return true;
        }
        if (BOOLEAN_PATHS.has(path)) {
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
          if (value !== null && PORT_PATHS.has(path)) {
            const n = Number(value);
            const isPort = PORT_PATHS.has(path);
            const valid = isPort ? Number.isInteger(n) && n >= 1 && n <= 65535 : Number.isInteger(n) && n >= 1;
            if (!valid) {
              const expected = isPort ? "a valid port number (1–65535)" : "a positive integer";
              errorResponse(res, 400, `Value for "${path}" must be ${expected}, got ${JSON.stringify(value)}`);
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
        // Routing paths carry their own shape and enum rules. Skipped for a
        // null/"" value, which is a delete rather than a set.
        if (value !== null && value !== "") {
          const routingError = validateRoutingChange(path, value);
          if (routingError) {
            errorResponse(res, 400, routingError);
            return true;
          }
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
