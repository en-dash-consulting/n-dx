/**
 * OpenAI API provider — calls OpenAI-compatible APIs via native fetch.
 *
 * Implements the generic {@link LLMProvider} interface for the "codex" vendor
 * in "api" mode. Uses the OpenAI Chat Completions API format:
 *
 * - `POST /v1/chat/completions` for completions
 * - `GET /v1/models` for auth validation
 *
 * ## When this provider is selected
 *
 * - When the "codex" vendor factory detects an API key (config or env)
 * - Explicitly via `hench run --provider=api --vendor=codex`
 *
 * ## Error handling
 *
 * Errors are classified into categories (auth, timeout, rate-limit, unknown)
 * with automatic retry on transient failures (429, 500, 502, 503)
 * using exponential backoff.
 *
 * ## Dependencies
 *
 * Uses native `fetch` (Node 18+) — no OpenAI SDK required.
 *
 * @see {@link createCodexCliClient} in `codex-cli-provider.ts` for the CLI alternative
 */

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";
import { ClaudeClientError } from "./types.js";
import type { LLMProvider, ProviderInfo, StreamChunk } from "./provider-interface.js";
import type { CodexConfig } from "./llm-types.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";

// ── Options ───────────────────────────────────────────────────────────────

/** Options for creating the OpenAI API provider. */
export interface OpenAiApiProviderOptions {
  /** Codex/OpenAI configuration section from `.n-dx.json`. */
  codexConfig?: CodexConfig;
  /** Environment variable name for API key fallback (default: "OPENAI_API_KEY"). */
  apiKeyEnv?: string;
  /** Maximum number of retries for transient failures (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum response tokens (default: 8192). */
  maxTokens?: number;
}

// ── Token parsing ─────────────────────────────────────────────────────────

/**
 * Parse token usage from an OpenAI API response `usage` object.
 *
 * OpenAI uses `prompt_tokens` / `completion_tokens` at the top level.
 * Maps to the shared TokenUsage shape: `prompt_tokens` → `input`,
 * `completion_tokens` → `output`.
 *
 * Always returns a TokenUsage — missing numeric fields default to 0.
 */
export function parseOpenAiTokenUsage(
  raw: Record<string, unknown>,
): TokenUsage {
  const input = typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : 0;
  const output = typeof raw.completion_tokens === "number" ? raw.completion_tokens : 0;
  return { input, output };
}

// ── Auth resolution ───────────────────────────────────────────────────────

/**
 * Resolve the OpenAI API key from config or environment.
 *
 * Priority:
 * 1. `codexConfig.api_key` from unified config (`.n-dx.json`)
 * 2. Environment variable (default: `OPENAI_API_KEY`)
 *
 * @returns The resolved API key, or undefined if not found.
 */
export function resolveOpenAiApiKey(
  codexConfig?: CodexConfig,
  apiKeyEnv = "OPENAI_API_KEY",
): string | undefined {
  return codexConfig?.api_key ?? process.env[apiKeyEnv];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Classify an HTTP status code into an ErrorReason and throw. */
function classifyAndThrow(status: number, message: string): never {
  if (status === 401 || status === 403) {
    throw new ClaudeClientError(message, "auth", false);
  }
  if (status === 408) {
    throw new ClaudeClientError(message, "timeout", true);
  }
  if (RETRY_STATUS_CODES.has(status)) {
    throw new ClaudeClientError(message, "rate-limit", true);
  }
  throw new ClaudeClientError(message, "unknown", false);
}

/** Build the base URL for OpenAI API requests. */
function resolveBaseUrl(codexConfig?: CodexConfig): string {
  return codexConfig?.api_endpoint ?? DEFAULT_BASE_URL;
}

/** Build common headers for OpenAI API requests. */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create an OpenAI API provider that implements the {@link LLMProvider} interface.
 *
 * Uses native `fetch` to call the OpenAI Chat Completions API.
 * Supports both blocking completions and streaming.
 *
 * @throws {ClaudeClientError} with reason "auth" if no API key is available.
 */
export function createOpenAiApiProvider(
  options: OpenAiApiProviderOptions = {},
): LLMProvider {
  const apiKeyEnv = options.apiKeyEnv ?? "OPENAI_API_KEY";
  const codexConfig = options.codexConfig;
  const apiKey = resolveOpenAiApiKey(codexConfig, apiKeyEnv);

  if (!apiKey) {
    throw new ClaudeClientError(
      `OpenAI API key not found. Set it via 'n-dx config codex.api_key <key>' or the ${apiKeyEnv} environment variable.`,
      "auth",
      false,
    );
  }

  const baseUrl = resolveBaseUrl(codexConfig);
  const headers = buildHeaders(apiKey);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const defaultModel = codexConfig?.model ?? DEFAULT_MODEL;

  const info: ProviderInfo = {
    vendor: "codex",
    mode: "api",
    ...(defaultModel ? { model: defaultModel } : {}),
    capabilities: ["streaming", "function-calling"],
  };

  return {
    info,

    async validateAuth(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (response.status === 401 || response.status === 403) {
          return false;
        }
        if (!response.ok) {
          throw new ClaudeClientError(
            `OpenAI models endpoint returned ${response.status}`,
            "unknown",
            false,
          );
        }
        return true;
      } catch (err) {
        if (err instanceof ClaudeClientError) throw err;
        throw new ClaudeClientError(
          (err as Error).message,
          "unknown",
          false,
        );
      }
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const model = request.model || defaultModel;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: [{ role: "user", content: request.prompt }],
            }),
          });

          if (!response.ok) {
            const body = await response.text();
            const message = `OpenAI API error ${response.status}: ${body}`;

            // Auth errors are not retryable
            if (response.status === 401 || response.status === 403) {
              throw new ClaudeClientError(message, "auth", false);
            }

            // Timeout-like errors
            if (response.status === 408) {
              throw new ClaudeClientError(message, "timeout", true);
            }

            // Retryable errors
            if (RETRY_STATUS_CODES.has(response.status) && attempt < maxRetries) {
              const delay = baseDelayMs * 2 ** attempt;
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }

            // Exhausted retries for retryable errors
            if (RETRY_STATUS_CODES.has(response.status)) {
              throw new ClaudeClientError(message, "rate-limit", true);
            }

            throw new ClaudeClientError(message, "unknown", false);
          }

          const data = await response.json() as Record<string, unknown>;
          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          let text = "";

          if (choices && choices.length > 0) {
            const message = choices[0].message as Record<string, unknown> | undefined;
            if (message && typeof message.content === "string") {
              text = message.content;
            }
          }

          const tokenUsage = data.usage
            ? parseOpenAiTokenUsage(data.usage as Record<string, unknown>)
            : undefined;

          return { text, tokenUsage };
        } catch (err) {
          if (err instanceof ClaudeClientError) {
            throw err;
          }
          lastError = err as Error;

          // Network/fetch errors may be transient
          if (attempt < maxRetries) {
            const delay = baseDelayMs * 2 ** attempt;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          throw new ClaudeClientError(
            (err as Error).message ?? "Unknown error",
            "unknown",
            false,
          );
        }
      }

      throw lastError ?? new ClaudeClientError("Exhausted retries", "unknown", false);
    },

    async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
      const model = request.model || defaultModel;

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: request.prompt }],
          stream: true,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        classifyAndThrow(
          response.status,
          `OpenAI API stream error ${response.status}: ${body}`,
        );
      }

      if (!response.body) {
        throw new ClaudeClientError(
          "OpenAI API returned no response body for stream",
          "unknown",
          false,
        );
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalUsage: TokenUsage | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last (possibly incomplete) line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed === "data: [DONE]") {
              yield { done: true, usage: totalUsage };
              return;
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
                const choices = data.choices as Array<Record<string, unknown>> | undefined;

                if (choices && choices.length > 0) {
                  const delta = choices[0].delta as Record<string, unknown> | undefined;
                  if (delta && typeof delta.content === "string") {
                    yield { text: delta.content };
                  }
                }

                // Some OpenAI-compatible endpoints include usage in stream chunks
                if (data.usage) {
                  totalUsage = parseOpenAiTokenUsage(
                    data.usage as Record<string, unknown>,
                  );
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }
        }

        // Flush any remaining buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed === "data: [DONE]") {
            yield { done: true, usage: totalUsage };
            return;
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Terminal chunk if we didn't get [DONE]
      yield { done: true, usage: totalUsage };
    },
  };
}
