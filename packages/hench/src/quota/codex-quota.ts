/**
 * Codex (OpenAI) quota adapter.
 *
 * Fetches real-time quota and usage data from the OpenAI billing API and
 * normalises the response to the vendor-agnostic QuotaRemaining interface.
 *
 * ## Adapter boundary
 *
 * All Codex/OpenAI-specific response shapes are internal to this module.
 * Callers receive only `QuotaRemaining` (on success) or `QuotaFetchError`
 * (on failure) — no OpenAI types cross the export surface.
 *
 * ## API endpoints used
 *
 *   GET /dashboard/billing/subscription  →  hard spending cap (USD)
 *   GET /dashboard/billing/usage         →  current-month usage (cents)
 *
 * Both require `Authorization: Bearer <api-key>`.
 */

import type { QuotaRemaining } from "./types.js";

// ── Error types ──────────────────────────────────────────────────────────────

/** Classification of a quota-fetch failure. */
export type QuotaFetchErrorKind = "auth" | "rate-limit" | "network" | "parse";

/**
 * Typed error returned when the Codex quota fetch cannot be completed.
 *
 * Callers use the `kind` discriminant to degrade gracefully per failure class:
 *   - "auth"       → no output, silently skip (missing or invalid key)
 *   - "rate-limit" → no output, silently skip (caller will try again next run)
 *   - "network"    → no output, silently skip (transient connectivity issue)
 *   - "parse"      → log warning, skip (unexpected response shape)
 */
export interface QuotaFetchError {
  /** Failure classification. */
  readonly kind: QuotaFetchErrorKind;
  /** Human-readable description suitable for logging. */
  readonly message: string;
}

// ── Result type ──────────────────────────────────────────────────────────────

/**
 * Discriminated-union result from `fetchCodexQuota`.
 *
 * Use `result.ok` to branch:
 * ```ts
 * const result = await fetchCodexQuota(opts);
 * if (result.ok) {
 *   // result.quota is QuotaRemaining
 * } else {
 *   // result.error is QuotaFetchError
 * }
 * ```
 */
export type CodexQuotaResult =
  | { readonly ok: true; readonly quota: QuotaRemaining }
  | { readonly ok: false; readonly error: QuotaFetchError };

// ── Options ──────────────────────────────────────────────────────────────────

/** Options for `fetchCodexQuota`. */
export interface FetchCodexQuotaOptions {
  /** OpenAI API key. Defaults to the `OPENAI_API_KEY` environment variable. */
  apiKey?: string;
  /** Model identifier embedded verbatim in the `QuotaRemaining` result. */
  model: string;
  /** Base API URL. Defaults to `https://api.openai.com`. */
  apiEndpoint?: string;
  /**
   * Injectable fetch implementation.
   *
   * Defaults to the global `fetch` (Node 18+). Override in unit tests to
   * avoid real network calls.
   */
  fetchFn?: typeof fetch;
}

// ── Internal OpenAI response shapes (not exported) ───────────────────────────

interface SubscriptionResponse {
  hard_limit_usd?: number;
}

interface UsageResponse {
  total_usage?: number; // cents
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://api.openai.com";

function classifyStatus(status: number): QuotaFetchErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  return "network";
}

async function fetchJson<T>(
  url: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; error: QuotaFetchError }> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: "network", message: `Network error fetching ${url}: ${message}` } };
  }

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    return {
      ok: false,
      error: { kind, message: `HTTP ${response.status} from ${url}` },
    };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    return {
      ok: false,
      error: { kind: "parse", message: `Failed to parse JSON response from ${url}` },
    };
  }

  return { ok: true, data };
}

/** Return an ISO date string (YYYY-MM-DD) for the given Date object. */
function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Public adapter ────────────────────────────────────────────────────────────

/**
 * Fetch real-time quota data from the OpenAI billing API.
 *
 * Makes two sequential HTTP requests to derive a percentage of spending
 * capacity remaining in the current billing period:
 *
 *   1. `GET /dashboard/billing/subscription` — hard spending cap (USD).
 *   2. `GET /dashboard/billing/usage?start_date=…&end_date=…` — month-to-date
 *      usage in cents.
 *
 * Computes:
 *   ```
 *   percentRemaining = clamp(0, 100, (1 − usedUSD / limitUSD) × 100)
 *   ```
 *
 * Returns a typed `QuotaFetchError` (never throws) on any of:
 *   - Missing API key
 *   - Network connectivity failure
 *   - HTTP 401/403 (auth error)
 *   - HTTP 429 (rate limit)
 *   - Unexpected JSON shape
 *
 * @param options - Configuration including API key, model, and optional overrides.
 * @returns `{ ok: true, quota }` on success or `{ ok: false, error }` on failure.
 */
export async function fetchCodexQuota(options: FetchCodexQuotaOptions): Promise<CodexQuotaResult> {
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

  // 1. Fetch the hard spending cap from the subscription endpoint.
  const subResult = await fetchJson<SubscriptionResponse>(
    `${base}/dashboard/billing/subscription`,
    apiKey,
    fetchFn,
  );
  if (!subResult.ok) {
    return { ok: false, error: subResult.error };
  }

  const hardLimitUsd = subResult.data.hard_limit_usd;
  if (typeof hardLimitUsd !== "number" || hardLimitUsd <= 0) {
    return {
      ok: false,
      error: {
        kind: "parse",
        message: "Subscription response is missing a valid hard_limit_usd value",
      },
    };
  }

  // 2. Fetch month-to-date usage.
  const now = new Date();
  const startDate = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const endDate = toISODate(now);

  const usageResult = await fetchJson<UsageResponse>(
    `${base}/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
    apiKey,
    fetchFn,
  );
  if (!usageResult.ok) {
    return { ok: false, error: usageResult.error };
  }

  const totalUsageCents = usageResult.data.total_usage;
  if (typeof totalUsageCents !== "number") {
    return {
      ok: false,
      error: {
        kind: "parse",
        message: "Usage response is missing a numeric total_usage value",
      },
    };
  }

  const usedUsd = totalUsageCents / 100;
  const percentRemaining = Math.max(0, Math.min(100, (1 - usedUsd / hardLimitUsd) * 100));

  return {
    ok: true,
    quota: {
      vendor: "codex",
      model: options.model,
      percentRemaining,
    },
  };
}
