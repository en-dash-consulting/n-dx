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

  // ── Authentication (401, invalid key, expired token) ──────────────
  const isAuthError =
    /\b401\b/.test(msg) ||
    /invalid.*api.*key/i.test(err.message) ||
    /authentication.*(fail|error|invalid|expired)/i.test(err.message) ||
    /unauthorized.*(request|access|error)/i.test(err.message);

  if (isAuthError) {
    if (vendor === "codex") {
      return {
        message: `Authentication failed — Codex CLI credentials were rejected.${suffix}`,
        suggestion:
          "Run 'codex login', then retry. If needed, set the binary path with: n-dx config llm.codex.cli_path /path/to/codex",
        category: "auth",
      };
    }
    return {
      message: `Authentication failed — your API key was rejected.${suffix}`,
      suggestion:
        "Check your API key with: n-dx config claude.apiKey, or switch to CLI mode.",
      category: "auth",
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
        `Rate limit exceeded — the API is temporarily throttling requests.${suffix}`,
      suggestion:
        `${retryHint}, or use a different model with --model.`,
      category: "rate-limit",
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
      message: `Token budget exhausted${usageDetail} — the configured spending limit was reached.${suffix}`,
      suggestion:
        "Increase budget with: ndx config rex.budget.tokens <value> or ndx config rex.budget.cost <value>.",
      category: "budget",
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
        message: `Network timeout — the connection to the API timed out.${suffix}`,
        suggestion: "Check your internet connection and proxy settings, then try again.",
        category: "network",
      };
    }
    return {
      message: `API timeout — the request took too long to process.${suffix}`,
      suggestion:
        "Try reducing input size or using a smaller/faster model with --model.",
      category: "timeout",
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
      message: `Network error — could not reach the API.${suffix}`,
      suggestion: "Check your internet connection and try again.",
      category: "network",
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
      };
    }
    return {
      message: "Claude CLI not found on your system.",
      suggestion:
        "Install it (npm install -g @anthropic-ai/claude-cli) or set an API key: n-dx config claude.apiKey <key>",
      category: "unknown",
    };
  }

  // ── Response parsing / truncation ─────────────────────────────────
  if (
    msg.includes("invalid json") ||
    msg.includes("schema validation") ||
    msg.includes("truncated")
  ) {
    return {
      message: `LLM returned an unparseable response.${suffix}`,
      suggestion:
        "Try again — LLM outputs can vary. If this persists, try a different model with --model.",
      category: "parse",
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
        `The API is temporarily overloaded or experiencing errors.${suffix}`,
      suggestion:
        "Wait a moment and retry. Consider using a different model with --model.",
      category: "server",
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────
  const label = ctx?.label ?? "complete the request";
  const authHint =
    vendor === "codex"
      ? "Check Codex CLI login (codex login) and your network connection, then try again."
      : "Check your API key and network connection, then try again.";
  return {
    message: `Failed to ${label}: ${err.message}${suffix}`,
    suggestion: authHint,
    category: "unknown",
  };
}
