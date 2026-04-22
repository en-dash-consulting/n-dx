/**
 * API provider — calls Claude via the Anthropic SDK directly.
 *
 * One half of the dual provider architecture. The API provider makes direct
 * HTTP requests to the Anthropic Messages API using `@anthropic-ai/sdk`.
 *
 * ## When this provider is selected
 *
 * - Explicitly via `createClient({ mode: "api" })`
 * - Automatically when an API key is available (from config or env)
 *
 * ## Use cases
 *
 * - CI/CD pipelines where the Claude CLI isn't installed
 * - Production environments with direct API access
 * - Scenarios requiring fine-grained control over API parameters
 *
 * ## Error handling
 *
 * Errors are classified into categories (auth, timeout, rate-limit, unknown)
 * with automatic retry on transient failures (429, 500, 502, 503, 529)
 * using exponential backoff.
 *
 * @see {@link createClient} in `create-client.ts` for provider selection logic
 * @see {@link createCliClient} in `cli-provider.ts` for the alternative provider
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ClaudeClient,
  ClaudeClientOptions,
  CompletionRequest,
  CompletionResult,
} from "./types.js";
import { ClaudeClientError } from "./types.js";
import { resolveApiKey, resolveModel } from "./config.js";
import { parseApiTokenUsage } from "./token-usage.js";
import type { LLMProvider, ProviderInfo } from "./provider-interface.js";
import {
  extractRetryAfterMs,
  formatRetryCountdown,
  shouldAutoRetry,
  DEFAULT_AUTO_RETRY_THRESHOLD_MS,
} from "./rate-limit.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 8192;

function defaultApiRateLimitOnRetry(attempt: number, maxAttempts: number, delayMs: number): void {
  const countdown = formatRetryCountdown(Math.round(delayMs / 1000));
  process.stderr.write(`Rate limited — retry in ${countdown} (attempt ${attempt} of ${maxAttempts})\n`);
}

/** Options specific to the API provider. */
export interface ApiProviderOptions extends ClaudeClientOptions {
  /** Maximum number of retries for transient failures (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum response tokens (default: 8192). */
  maxTokens?: number;
  /**
   * Maximum Retry-After wait (ms) before the provider auto-retries.
   * When a 429 response includes a Retry-After ≤ this threshold, the
   * provider waits the specified duration then retries automatically.
   * Default: 60 000 ms (60 s).
   */
  autoRetryThresholdMs?: number;
  /**
   * Called before each rate-limit retry sleep.
   * Receives the upcoming attempt number (1-based, so 2 = first retry),
   * the total attempt count, and the delay in milliseconds.
   * When omitted, a default message is written to stderr.
   */
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void;
}

/**
 * Create an API-based Claude client that implements both the legacy
 * {@link ClaudeClient} interface and the generic {@link LLMProvider} interface.
 *
 * Uses the Anthropic SDK to make direct API calls. The API key is resolved
 * from the unified config or environment variable.
 *
 * @throws {ClaudeClientError} with reason "auth" if no API key is available.
 */
export function createApiClient(options: ApiProviderOptions): ClaudeClient & LLMProvider {
  const apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = resolveApiKey(options.claudeConfig, apiKeyEnv);

  if (!apiKey) {
    throw new ClaudeClientError(
      `API key not found. Set it via 'n-dx config claude.api_key <key>' or the ${apiKeyEnv} environment variable.`,
      "auth",
      false,
    );
  }

  const clientOpts: Record<string, unknown> = { apiKey };
  if (options.claudeConfig.api_endpoint) {
    clientOpts.baseURL = options.claudeConfig.api_endpoint;
  }

  const client = new Anthropic(clientOpts as ConstructorParameters<typeof Anthropic>[0]);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const autoRetryThresholdMs = options.autoRetryThresholdMs ?? DEFAULT_AUTO_RETRY_THRESHOLD_MS;
  const onRetry = options.onRetry ?? defaultApiRateLimitOnRetry;

  const info: ProviderInfo = {
    vendor: "claude",
    mode: "api",
    ...(options.claudeConfig.model ? { model: options.claudeConfig.model } : {}),
    capabilities: [],
  };

  return {
    // ── LLMProvider ──────────────────────────────────────────────────────
    info,

    async validateAuth(): Promise<boolean> {
      try {
        await client.models.list();
        return true;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
          return false;
        }
        throw new ClaudeClientError(
          (err as Error).message,
          "unknown",
          false,
        );
      }
    },

    // ── ClaudeClient (backward compat) ───────────────────────────────────
    mode: "api",

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await client.messages.create({
            model: resolveModel(request.model),
            max_tokens: maxTokens,
            messages: [{ role: "user", content: request.prompt }],
          });

          // Extract text from response blocks
          let text = "";
          for (const block of response.content) {
            if (block.type === "text") {
              text += block.text;
            }
          }

          const tokenUsage = parseApiTokenUsage(
            response.usage as unknown as Record<string, unknown>,
          );

          return { text, tokenUsage };
        } catch (err) {
          lastError = err as Error;
          const status = (err as { status?: number }).status;

          // Classify the error
          if (status === 401 || status === 403) {
            throw new ClaudeClientError(
              (err as Error).message,
              "auth",
              false,
            );
          }

          if (status === 408 || (err as Error).message?.includes("timeout")) {
            throw new ClaudeClientError(
              (err as Error).message,
              "timeout",
              true,
            );
          }

          // For retryable status codes, compute delay — preferring Retry-After
          // from the response headers over blind exponential backoff.
          if (status && RETRY_STATUS_CODES.has(status) && attempt < maxRetries) {
            const retryAfterMs = extractRetryAfterMs(err);
            const backoffDelay = baseDelayMs * 2 ** attempt;

            // If we have a Retry-After header, honor it when within the
            // auto-retry threshold. Otherwise fall back to exponential backoff.
            const delay =
              retryAfterMs != null && shouldAutoRetry(retryAfterMs, autoRetryThresholdMs)
                ? retryAfterMs
                : backoffDelay;

            if (status === 429) {
              onRetry(attempt + 2, maxRetries + 1, delay);
            }

            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          if (status && RETRY_STATUS_CODES.has(status)) {
            const retryAfterMs = extractRetryAfterMs(err);
            throw new ClaudeClientError(
              (err as Error).message,
              "rate-limit",
              true,
              retryAfterMs,
            );
          }

          throw new ClaudeClientError(
            (err as Error).message,
            "unknown",
            false,
          );
        }
      }

      // When all retries are exhausted due to rate limiting, preserve
      // any Retry-After metadata on the final error for upstream consumers.
      if (lastError instanceof ClaudeClientError && lastError.reason === "rate-limit") {
        throw lastError;
      }

      throw lastError;
    },
  };
}
