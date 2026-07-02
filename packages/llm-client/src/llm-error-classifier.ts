/**
 * Shared LLM error classifier — structured error classification for any
 * LLM-calling command across all n-dx packages.
 *
 * Lives in the foundation tier so both rex and sourcevision can import it
 * without violating the domain-layer independence constraint.
 */

import type { LLMVendor } from "./llm-types.js";
import { formatRetryCountdown, classifyTimeout } from "./rate-limit.js";
import type { TimeoutKind } from "./rate-limit.js";
import { CLI_ERROR_CODES } from "./types.js";
import type { CLIErrorCode } from "./types.js";

/** Error categories returned by {@link classifyLLMError}. */
export type LLMErrorCategory =
  | "rate-limit"
  | "auth"
  | "budget"
  | "parse"
  | "network"
  | "server"
  | "timeout"
  | "unknown";

/** Structured result from {@link classifyLLMError}. */
export interface LLMErrorClassification {
  message: string;
  suggestion: string;
  category: LLMErrorCategory;
  /**
   * Stable CLI error code matching the category. Lets CLI wrap sites label the
   * error accurately (e.g. NDX_CLI_LLM_RATE_LIMITED) instead of defaulting to
   * NDX_CLI_GENERIC.
   */
  code: CLIErrorCode;
}

/**
 * Extract a concise, human-readable provider reason from a raw error message.
 *
 * Vendor adapters embed the raw API response in the thrown error message:
 *   - Google/OpenAI: `"<Vendor> API error <NNN>: {json body}"`
 *   - Claude SDK / CLI providers: a plain message or stderr string
 *
 * The friendly classifier branches (rate-limit, auth, server, …) otherwise
 * discard this, hiding the part that distinguishes e.g. a daily quota
 * (RESOURCE_EXHAUSTED) from a transient per-minute throttle. This helper pulls
 * out a short detail string to append to those messages, uniformly across
 * vendors. Returns "" when there is nothing useful to add.
 */
export function extractProviderDetail(rawMessage: string): string {
  if (!rawMessage) return "";

  // Strip a leading "<Vendor> API error <NNN>: " / "... stream error <NNN>: "
  // prefix produced by the fetch-based providers, leaving the raw body.
  const prefix = /^[A-Za-z][\w.-]* API(?: stream)? error \d+:\s*/;
  const body = rawMessage.replace(prefix, "").trim();
  if (!body) return "";

  let detail = body;

  // Google and OpenAI both return { error: { message, status?, code? } }.
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as {
        error?: {
          message?: unknown;
          status?: unknown;
          code?: unknown;
          details?: Array<Record<string, unknown>>;
        };
      };
      const err = parsed.error;
      if (err && typeof err === "object") {
        const message = typeof err.message === "string" ? err.message : "";
        const label =
          typeof err.status === "string"
            ? err.status
            : typeof err.code === "string"
              ? err.code
              : "";
        // Google quota errors carry the daily-vs-throttle signal in details[].
        const extras: string[] = [];
        for (const d of err.details ?? []) {
          const metric = (d.violations as Array<Record<string, unknown>> | undefined)?.[0]
            ?.quotaMetric;
          if (typeof metric === "string") extras.push(metric);
          if (typeof d.retryDelay === "string") extras.push(`retry in ${d.retryDelay}`);
        }
        const head = label && message ? `${label}: ${message}` : label || message;
        detail = [head, ...extras].filter(Boolean).join(" — ") || body;
      }
    } catch {
      // Not JSON after all — fall back to the raw body.
    }
  }

  // Collapse whitespace and truncate so multi-line bodies don't flood the terminal.
  detail = detail.replace(/\s+/g, " ").trim();
  if (detail.length > 300) detail = `${detail.slice(0, 297)}…`;
  return detail;
}

/**
 * Optional enrichment context passed to {@link classifyLLMError}.
 *
 * When provided, error messages include the command that failed, the
 * vendor/model in use, and — for budget errors — current usage vs limit.
 */
export interface LLMErrorContext {
  /** Human-readable label for what was being attempted (e.g. "analyze PRD"). */
  label?: string;
  /** The CLI command that triggered the error (e.g. "ndx plan"). */
  command?: string;
  /** The LLM model that was in use (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /**
   * Retry-After delay in seconds, typically from an HTTP header.
   * When present, the rate-limit message includes a formatted countdown.
   */
  retryAfterSeconds?: number;
  /** Current token usage when a budget error occurs. */
  budgetUsed?: number;
  /** Configured token budget limit. */
  budgetLimit?: number;
}

/**
 * Build a suffix string like " [ndx plan · claude · claude-sonnet-4-6]"
 * for inclusion in error messages. Only emits a suffix when the caller
 * provided at least a command or model — plain string context and bare
 * vendor-only calls produce no suffix.
 */
function formatErrorSuffix(
  vendor: LLMVendor,
  ctx?: LLMErrorContext,
): string {
  if (ctx == null) return "";
  // Only include a suffix when the caller supplied actionable context
  // beyond what the classifier infers (command and/or model).
  if (!ctx.command && !ctx.model) return "";
  const parts: string[] = [];
  if (ctx.command) parts.push(ctx.command);
  parts.push(vendor);
  if (ctx.model) parts.push(ctx.model);
  return ` [${parts.join(" · ")}]`;
}

/**
 * Classify an LLM error and return a user-friendly message, suggestion, and category.
 *
 * Covers: auth failures, rate limits, network issues, response parsing,
 * server/overloaded errors, budget exhaustion, and timeouts.
 *
 * @param err        - The raw error to classify.
 * @param vendor     - Which LLM vendor was in use (affects suggestion wording).
 * @param context    - Optional context: a string label for the fallback message,
 *                     or an {@link LLMErrorContext} object for enriched output.
 */
export function classifyLLMError(
  err: Error,
  vendor: LLMVendor = "claude",
  context?: string | LLMErrorContext,
): LLMErrorClassification {
  const msg = err.message.toLowerCase();
  const ctx = typeof context === "string" ? { label: context } as LLMErrorContext : context;
  const suffix = formatErrorSuffix(vendor, ctx);

  // Upstream parsers (e.g. parseProposalResponse) may embed a
  // `[ndx-debug:<path>]` sentinel in the thrown error message, pointing at a
  // file containing the raw LLM response. Extract it so the parse branch can
  // surface the path and underlying error detail back to the user.
  const debugMatch = /\s*\[ndx-debug:([^\]]+)\]/.exec(err.message);
  const debugPath = debugMatch ? debugMatch[1] : null;
  const cleanedMessage = debugMatch
    ? err.message.replace(debugMatch[0], "").trim()
    : err.message;

  // Concise provider reason (e.g. Gemini's RESOURCE_EXHAUSTED + quota metric),
  // appended to the friendly branches so errors are self-diagnosing.
  const detail = extractProviderDetail(cleanedMessage);
  const detailSuffix = detail ? ` (${detail})` : "";

  // ── Authentication (401, invalid key, expired token) ──────────────
  const isAuthError =
    /\b401\b/.test(msg) ||
    /invalid.*api.*key/i.test(err.message) ||
    /authentication.*(fail|error|invalid|expired)/i.test(err.message) ||
    /unauthorized.*(request|access|error)/i.test(err.message);

  if (isAuthError) {
    if (vendor === "codex") {
      return {
        message: `Authentication failed — Codex CLI credentials were rejected.${suffix}${detailSuffix}`,
        suggestion:
          "Run 'codex login', then retry. If needed, set the binary path with: n-dx config llm.codex.cli_path /path/to/codex",
        category: "auth",
        code: CLI_ERROR_CODES.AUTH_FAILED,
      };
    }
    if (vendor === "google") {
      return {
        message: `Authentication failed — your Google API key was rejected.${suffix}${detailSuffix}`,
        suggestion:
          "Check your API key with: n-dx config llm.google.api_key <key>, or set the GEMINI_API_KEY environment variable.",
        category: "auth",
        code: CLI_ERROR_CODES.AUTH_FAILED,
      };
    }
    return {
      message: `Authentication failed — your API key was rejected.${suffix}${detailSuffix}`,
      suggestion:
        "Check your API key with: n-dx config claude.apiKey, or switch to CLI mode.",
      category: "auth",
      code: CLI_ERROR_CODES.AUTH_FAILED,
    };
  }

  // ── Rate limiting (429, retry-after) ──────────────────────────────
  if (
    /\b429\b/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("retry-after")
  ) {
    // Prefer structured retryAfterSeconds from context, fall back to regex on message.
    let retryHint: string;
    if (ctx?.retryAfterSeconds != null && ctx.retryAfterSeconds > 0) {
      retryHint = `Rate limited — retry in ${formatRetryCountdown(ctx.retryAfterSeconds)}`;
    } else {
      const retryMatch = /retry-after[:\s]*(\d+)/i.exec(err.message);
      if (retryMatch) {
        retryHint = `Rate limited — retry in ${formatRetryCountdown(Number(retryMatch[1]))}`;
      } else {
        retryHint = "Wait a few minutes and try again";
      }
    }
    return {
      message:
        `Rate limit exceeded — the API is temporarily throttling requests.${suffix}${detailSuffix}`,
      suggestion:
        `${retryHint}, or use a different model with --model.`,
      category: "rate-limit",
      code: CLI_ERROR_CODES.LLM_RATE_LIMITED,
    };
  }

  // ── Budget exhaustion ─────────────────────────────────────────────
  if (
    msg.includes("budget exceeded") ||
    (msg.includes("budget") && msg.includes("exhausted")) ||
    (msg.includes("token limit") && msg.includes("exceeded"))
  ) {
    let usageDetail = "";
    if (ctx?.budgetUsed != null && ctx.budgetLimit != null) {
      usageDetail = ` (${ctx.budgetUsed.toLocaleString()} / ${ctx.budgetLimit.toLocaleString()} tokens used)`;
    }
    return {
      message: `Token budget exhausted${usageDetail} — the configured spending limit was reached.${suffix}${detailSuffix}`,
      suggestion:
        "Increase budget with: ndx config rex.budget.tokens <value> or ndx config rex.budget.cost <value>.",
      category: "budget",
      code: CLI_ERROR_CODES.BUDGET_EXCEEDED,
    };
  }

  // ── Timeout errors — distinguish network vs API ───────────────────
  const isTimeout =
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("timed out") ||
    /\b408\b/.test(msg);

  if (isTimeout) {
    const kind: TimeoutKind = classifyTimeout(err);
    if (kind === "network") {
      return {
        message: `Network timeout — the connection to the API timed out.${suffix}${detailSuffix}`,
        suggestion: "Check your internet connection and proxy settings, then try again.",
        category: "network",
        code: CLI_ERROR_CODES.NETWORK_ERROR,
      };
    }
    return {
      message: `API timeout — the request took too long to process.${suffix}${detailSuffix}`,
      suggestion:
        "Try reducing input size or using a smaller/faster model with --model.",
      category: "timeout",
      code: CLI_ERROR_CODES.TIMEOUT,
    };
  }

  // ── Network / connectivity (non-timeout) ──────────────────────────
  if (
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  ) {
    return {
      message: `Network error — could not reach the API.${suffix}${detailSuffix}`,
      suggestion: "Check your internet connection and try again.",
      category: "network",
      code: CLI_ERROR_CODES.NETWORK_ERROR,
    };
  }

  // ── CLI not found ─────────────────────────────────────────────────
  if (
    msg.includes("codex cli not found") ||
    msg.includes("claude cli not found") ||
    (msg.includes("enoent") &&
      (msg.includes("claude") || msg.includes("codex")))
  ) {
    if (vendor === "codex") {
      return {
        message: "Codex CLI not found on your system.",
        suggestion:
          "Install Codex CLI and/or set its path: n-dx config llm.codex.cli_path /path/to/codex",
        category: "unknown",
        code: CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
      };
    }
    return {
      message: "Claude CLI not found on your system.",
      suggestion:
        "Install it (npm install -g @anthropic-ai/claude-cli) or set an API key: n-dx config claude.apiKey <key>",
      category: "unknown",
      code: CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
    };
  }

  // ── Response parsing / truncation ─────────────────────────────────
  if (
    msg.includes("invalid json") ||
    msg.includes("schema validation") ||
    msg.includes("truncated")
  ) {
    let message = `LLM returned an unparseable response.${suffix}`;
    let suggestion =
      "Try again — LLM outputs can vary. If this persists, try a different model with --model.";
    if (debugPath) {
      message += ` Raw response saved to ${debugPath}. Underlying error: ${cleanedMessage}.`;
      suggestion +=
        " Inspect the captured response to see what the LLM actually returned.";
    }
    return {
      message,
      suggestion,
      category: "parse",
      code: CLI_ERROR_CODES.JSON_PARSE_FAILED,
    };
  }

  // ── Overloaded / server errors (529, 503, 500) ────────────────────
  if (
    /\b(529|503|500)\b/.test(msg) ||
    msg.includes("overloaded") ||
    msg.includes("server error")
  ) {
    return {
      message:
        `The API is temporarily overloaded or experiencing errors.${suffix}${detailSuffix}`,
      suggestion:
        "Wait a moment and retry. Consider using a different model with --model.",
      category: "server",
      code: CLI_ERROR_CODES.LLM_SERVER_ERROR,
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────
  const label = ctx?.label ?? "complete the request";
  const authHint =
    vendor === "codex"
      ? "Check Codex CLI login (codex login) and your network connection, then try again."
      : vendor === "google"
        ? "Check your Google API key (GEMINI_API_KEY) and network connection, then retry."
        : "Check your API key and network connection, then try again.";
  return {
    message: `Failed to ${label}: ${err.message}${suffix}`,
    suggestion: authHint,
    category: "unknown",
    code: CLI_ERROR_CODES.GENERIC,
  };
}
