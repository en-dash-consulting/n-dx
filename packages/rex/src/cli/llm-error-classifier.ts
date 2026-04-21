/**
 * Shared LLM error classifier — structured error classification for any
 * LLM-calling command (smart-add, reshape, reorganize, prune, etc.).
 *
 * Extracts the classification logic that was originally inline in smart-add.ts
 * so all LLM-calling commands produce consistent, actionable error messages.
 */

import type { LLMVendor } from "@n-dx/llm-client";

/** Error categories returned by {@link classifyLLMError}. */
export type LLMErrorCategory =
  | "rate-limit"
  | "auth"
  | "budget"
  | "parse"
  | "network"
  | "server"
  | "unknown";

/** Structured result from {@link classifyLLMError}. */
export interface LLMErrorClassification {
  message: string;
  suggestion: string;
  category: LLMErrorCategory;
}

/**
 * Classify an LLM error and return a user-friendly message, suggestion, and category.
 *
 * Covers: auth failures, rate limits, network issues, response parsing,
 * server/overloaded errors, budget exhaustion, and timeouts.
 *
 * @param err        - The raw error to classify.
 * @param vendor     - Which LLM vendor was in use (affects suggestion wording).
 * @param context    - Optional context label for the generic fallback message
 *                     (e.g. "analyze description", "process ideas file").
 */
export function classifyLLMError(
  err: Error,
  vendor: LLMVendor = "claude",
  context?: string,
): LLMErrorClassification {
  const msg = err.message.toLowerCase();

  // ── Authentication (401, invalid key, expired token) ──────────────
  const isAuthError =
    /\b401\b/.test(msg) ||
    /invalid.*api.*key/i.test(err.message) ||
    /authentication.*(fail|error|invalid|expired)/i.test(err.message) ||
    /unauthorized.*(request|access|error)/i.test(err.message);

  if (isAuthError) {
    if (vendor === "codex") {
      return {
        message: "Authentication failed — Codex CLI credentials were rejected.",
        suggestion:
          "Run 'codex login', then retry. If needed, set the binary path with: n-dx config llm.codex.cli_path /path/to/codex",
        category: "auth",
      };
    }
    return {
      message: "Authentication failed — your API key was rejected.",
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
    return {
      message:
        "Rate limit exceeded — the API is temporarily throttling requests.",
      suggestion:
        "Wait a few minutes and try again, or use a different model with --model.",
      category: "rate-limit",
    };
  }

  // ── Budget exhaustion ─────────────────────────────────────────────
  if (
    msg.includes("budget exceeded") ||
    msg.includes("budget") && msg.includes("exhausted") ||
    msg.includes("token limit") && msg.includes("exceeded")
  ) {
    return {
      message: "Token budget exhausted — the configured spending limit was reached.",
      suggestion:
        "Adjust budget with: n-dx config rex.budget.tokens <value> or rex.budget.cost <value>.",
      category: "budget",
    };
  }

  // ── Network / connectivity ────────────────────────────────────────
  if (
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("fetch failed")
  ) {
    return {
      message: "Network error — could not reach the API.",
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
      message: "LLM returned an unparseable response.",
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
        "The API is temporarily overloaded or experiencing errors.",
      suggestion:
        "Wait a moment and retry. Consider using a different model with --model.",
      category: "server",
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────
  const label = context ?? "complete the request";
  const authHint =
    vendor === "codex"
      ? "Check Codex CLI login (codex login) and your network connection, then try again."
      : "Check your API key and network connection, then try again.";
  return {
    message: `Failed to ${label}: ${err.message}`,
    suggestion: authHint,
    category: "unknown",
  };
}
