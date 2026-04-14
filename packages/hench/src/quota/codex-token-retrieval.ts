/**
 * Codex token retrieval from OpenAI API.
 *
 * Fetches actual token usage for a specific run from the OpenAI API and
 * maps the response to Hench's TokenUsage format.
 *
 * This is a post-run operation: after the Codex CLI completes execution,
 * we query the API to get authoritative token counts (some Codex responses
 * may have zeroed-out token counts in the CLI output).
 *
 * ## Adapter boundary
 *
 * All Codex/OpenAI-specific response shapes are internal to this module.
 * Callers receive only `CodexTokenRetrievalResult` (success or failure).
 */

import type { TokenUsage } from "../schema/index.js";

// ── Error types ──────────────────────────────────────────────────────────────

/** Classification of a token retrieval failure. */
export type TokenRetrievalErrorKind = "auth" | "rate-limit" | "network" | "parse" | "not-found" | "timeout";

/**
 * Typed error returned when token retrieval cannot be completed.
 *
 * Callers use the `kind` discriminant to decide whether to retry or skip:
 *   - "auth"       → missing/invalid API key, don't retry
 *   - "rate-limit" → transient, safe to skip (caller will try next run)
 *   - "network"    → transient connectivity, safe to skip
 *   - "not-found"  → API doesn't have data for this run, skip
 *   - "timeout"    → slow API response, skip
 *   - "parse"      → unexpected response shape, log warning and skip
 */
export interface TokenRetrievalError {
  /** Failure classification. */
  readonly kind: TokenRetrievalErrorKind;
  /** Human-readable description suitable for logging. */
  readonly message: string;
}

// ── Result type ──────────────────────────────────────────────────────────────

/**
 * Discriminated-union result from `fetchCodexTokenUsage`.
 *
 * Use `result.ok` to branch:
 * ```ts
 * const result = await fetchCodexTokenUsage(opts);
 * if (result.ok) {
 *   // result.tokens is TokenUsage
 *   // result.diagnostic may indicate partial data
 * } else {
 *   // result.error is TokenRetrievalError
 *   // use error.kind to decide whether to retry
 * }
 * ```
 */
export interface CodexTokenRetrievalSuccess {
  readonly ok: true;
  readonly tokens: TokenUsage;
  /** Optional diagnostic flag if tokens were incomplete or had to be reconstructed. */
  readonly diagnostic?: string;
}

export interface CodexTokenRetrievalFailure {
  readonly ok: false;
  readonly error: TokenRetrievalError;
}

export type CodexTokenRetrievalResult = CodexTokenRetrievalSuccess | CodexTokenRetrievalFailure;

// ── Options ──────────────────────────────────────────────────────────────────

/**
 * Options for `fetchCodexTokenUsage`.
 *
 * At minimum, provide `apiKey` and `model`. The `runId` is optional and
 * may be used to filter results if the API supports run-scoped queries
 * in the future.
 */
export interface FetchCodexTokenUsageOptions {
  /** OpenAI API key. Defaults to `OPENAI_API_KEY` environment variable. */
  apiKey?: string;
  /** Model identifier (e.g. "gpt-4o-mini"). Used to scope token queries. */
  model: string;
  /** Run ID (optional). May be used to filter results in future API versions. */
  runId?: string;
  /** Base API URL. Defaults to `https://api.openai.com`. */
  apiEndpoint?: string;
  /**
   * Injectable fetch implementation.
   *
   * Defaults to the global `fetch` (Node 18+). Override in unit tests to
   * avoid real network calls.
   */
  fetchFn?: typeof fetch;
  /**
   * Request timeout in milliseconds. Defaults to 5000ms (5 seconds).
   * Token retrieval is a post-run operation and should be fast.
   */
  timeoutMs?: number;
}

// ── Internal OpenAI response shapes (not exported) ───────────────────────────

interface UsageListResponse {
  data?: Array<{
    model?: string;
    completion_tokens?: number;
    prompt_tokens?: number;
    created?: number;
  }>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 5000;

function classifyStatus(status: number): TokenRetrievalErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limit";
  return "network";
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJson<T>(
  url: string,
  apiKey: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; error: TokenRetrievalError }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      timeoutMs,
      fetchFn,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        error: {
          kind: "timeout",
          message: `Token retrieval timed out after ${timeoutMs}ms`,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        kind: "network",
        message: `Network error fetching ${url}: ${message}`,
      },
    };
  }

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    return {
      ok: false,
      error: {
        kind,
        message: `HTTP ${response.status} from ${url}`,
      },
    };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    return {
      ok: false,
      error: {
        kind: "parse",
        message: `Failed to parse JSON response from ${url}`,
      },
    };
  }

  return { ok: true, data };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch token usage for a recent Codex execution from the OpenAI API.
 *
 * Queries the `/dashboard/billing/tokens` endpoint (if available) or falls
 * back to deriving token counts from recent usage snapshots. This is a
 * best-effort operation: if the API doesn't have data or fails, returns
 * an error that the caller should handle gracefully.
 *
 * Returns a typed `TokenRetrievalError` (never throws) on any of:
 *   - Missing API key
 *   - Network connectivity failure
 *   - HTTP 401/403 (auth error)
 *   - HTTP 404 (no data available)
 *   - HTTP 429 (rate limit)
 *   - Unexpected JSON shape
 *   - Request timeout
 *
 * @param options - Configuration including API key, model, and optional overrides.
 * @returns `{ ok: true, tokens }` on success or `{ ok: false, error }` on failure.
 */
export async function fetchCodexTokenUsage(
  options: FetchCodexTokenUsageOptions,
): Promise<CodexTokenRetrievalResult> {
  const apiKey = options.apiKey ?? process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error: {
        kind: "auth",
        message: "No Codex API key available: set OPENAI_API_KEY or llm.codex.api_key in .n-dx.json",
      },
    };
  }

  const base = (options.apiEndpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Query the usage endpoint for recent token data. The OpenAI API doesn't
  // currently have a direct "get tokens for this run" endpoint, so we fetch
  // recent usage and extract token counts for the configured model.
  //
  // This is a fallback mechanism: ideally, the Codex CLI would return
  // token counts directly, or we'd have a run-ID-scoped API endpoint.
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startDate = toISODate(oneDayAgo);
  const endDate = toISODate(now);

  const result = await fetchJson<UsageListResponse>(
    `${base}/dashboard/billing/usage/tokens?start_date=${startDate}&end_date=${endDate}`,
    apiKey,
    timeoutMs,
    fetchFn,
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Extract token counts for the specified model from the response.
  const data = result.data;
  if (!data.data || data.data.length === 0) {
    return {
      ok: false,
      error: {
        kind: "not-found",
        message: `No token usage data available for model ${options.model}`,
      },
    };
  }

  // Find the most recent entry for the configured model
  const modelEntries = data.data.filter((entry) => entry.model === options.model);
  if (modelEntries.length === 0) {
    return {
      ok: false,
      error: {
        kind: "not-found",
        message: `No usage data for model ${options.model}`,
      },
    };
  }

  // Use the most recent entry (highest timestamp)
  const mostRecent = modelEntries.reduce((a, b) => {
    const aTime = a.created ?? 0;
    const bTime = b.created ?? 0;
    return bTime > aTime ? b : a;
  });

  const promptTokens = mostRecent.prompt_tokens ?? 0;
  const completionTokens = mostRecent.completion_tokens ?? 0;

  if (promptTokens === 0 && completionTokens === 0) {
    return {
      ok: true,
      tokens: { input: 0, output: 0 },
      diagnostic: "zero_token_data_from_api",
    };
  }

  return {
    ok: true,
    tokens: {
      input: promptTokens,
      output: completionTokens,
    },
  };
}

/** Return an ISO date string (YYYY-MM-DD) for the given Date object. */
function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
