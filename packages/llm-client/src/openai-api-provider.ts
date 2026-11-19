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

import { resolveOpenAiEffort, usesOpenAiCompletionTokenLimit } from "./codex-effort.js";

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";
import { ClaudeClientError } from "./types.js";
import { LLM_VENDOR, type LLMProvider, type ProviderInfo, type StreamChunk } from "./provider-interface.js";
import type { CodexConfig } from "./llm-types.js";
import { requireVendorApiKey, resolveVendorKey } from "./vendor-auth.js";
import { NEWEST_MODELS, resolveApiEndpoint } from "./config.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = NEWEST_MODELS.codex;

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

/** Parse Chat Completions usage into disjoint pricing categories. */
export function parseOpenAiTokenUsage(raw: Record<string, unknown>): TokenUsage {
  return parseUsage(raw).tokenUsage ?? { input: 0, output: 0 };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Both blocking and streaming calls use the same validation and accounting. */
function parseUsage(raw: unknown): Pick<CompletionResult, "tokenUsage" | "usageStatus"> {
  if (raw == null) return { usageStatus: "unavailable" };
  const source = record(raw);
  if (!source) return { usageStatus: "malformed" };
  let malformed = false;
  const count = (obj: Record<string, unknown>, key: string): number | undefined => {
    const value = obj[key];
    if (value === undefined) return undefined;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    malformed = true;
    return undefined;
  };
  const input = count(source, "prompt_tokens");
  const output = count(source, "completion_tokens");
  const details = record(source.prompt_tokens_details);
  if (source.prompt_tokens_details != null && !details) malformed = true;
  const read = count(details ?? {}, "cached_tokens");
  const write = count(details ?? {}, "cache_write_tokens");
  const cached = (read ?? 0) + (write ?? 0);
  if (input !== undefined && cached > input) malformed = true;
  const present = [input, output, read, write].some(value => value !== undefined);
  return {
    tokenUsage: present ? {
      // OpenAI reports both cache categories inside prompt_tokens.
      input: Math.max(0, (input ?? 0) - cached),
      output: output ?? 0,
      ...(read ? { cacheReadInput: read } : {}),
      ...(write ? { cacheCreationInput: write } : {}),
    } : undefined,
    usageStatus: malformed ? "malformed"
      : input !== undefined && output !== undefined ? "measured"
      : present ? "partial" : "unavailable",
  };
}

// ── Auth resolution ───────────────────────────────────────────────────────

/**
 * Resolve the OpenAI API key ({@link resolveVendorKey}):
 * 1. `codexConfig.api_key` from unified config (`.n-dx.json`)
 * 2. Environment variable (default: `OPENAI_API_KEY`)
 * 3. The per-user credential store's `codex` entry
 *
 * It runs a stored helper and ignores `llm.codex.auth`, so a key found here
 * never means "use the API": that is `resolveVendorAuth(...).mode`.
 *
 * @returns The resolved API key, or undefined if not found.
 */
export function resolveOpenAiApiKey(
  codexConfig?: CodexConfig,
  apiKeyEnv = "OPENAI_API_KEY",
): string | undefined {
  return resolveVendorKey(LLM_VENDOR.CODEX, codexConfig ? { codex: codexConfig } : {}, { apiKeyEnv })?.value;
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
  return resolveApiEndpoint(codexConfig, DEFAULT_BASE_URL);
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
  // Throws when llm.codex.auth rules the API out or no key may be used.
  const apiKey = requireVendorApiKey(LLM_VENDOR.CODEX, codexConfig ? { codex: codexConfig } : {}, { apiKeyEnv }).value;

  const baseUrl = resolveBaseUrl(codexConfig);
  const headers = buildHeaders(apiKey);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const defaultModel = codexConfig?.model ?? DEFAULT_MODEL;

  const info: ProviderInfo = {
    vendor: LLM_VENDOR.CODEX,
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
      const effort = resolveOpenAiEffort(model, request.effort, request.taskClass);
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              ...(usesOpenAiCompletionTokenLimit(model)
                ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
              ...(effort !== undefined ? { reasoning_effort: effort } : {}),
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

          return { text, ...parseUsage(data.usage) };
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
      const effort = resolveOpenAiEffort(model, request.effort, request.taskClass);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          ...(usesOpenAiCompletionTokenLimit(model)
            ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
          ...(effort !== undefined ? { reasoning_effort: effort } : {}),
          messages: [{ role: "user", content: request.prompt }],
          stream: true,
          stream_options: { include_usage: true },
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
      let accounting = parseUsage(undefined);
      let snapshot: Record<string, unknown> = {};
      let malformedEvent = false;
      const terminal = (finished: boolean): StreamChunk => ({
        done: true,
        usage: accounting.tokenUsage,
        usageStatus: malformedEvent ? "malformed"
          : !finished && accounting.usageStatus === "measured" ? "partial"
          : accounting.usageStatus,
      });
      const parseLine = (line: string): StreamChunk | undefined => {
        const trimmed = line.trim();
        if (trimmed === "data: [DONE]") return terminal(true);
        if (!trimmed.startsWith("data:")) return undefined;
        let payload: unknown;
        try {
          payload = JSON.parse(trimmed.slice(5).trimStart());
        } catch {
          // Retain prior spend but never label a damaged stream fully measured.
          malformedEvent = true;
          return undefined;
        }
        const data = record(payload);
        if (!data) {
          malformedEvent = true;
          return undefined;
        }
        if (data.usage != null) {
          const next = parseUsage(data.usage);
          const raw = record(data.usage);
          if (next.usageStatus === "malformed") malformedEvent = true;
          if (raw) {
            // Preserve each valid counter, even when a sibling is malformed.
            // Snapshots replace counters; they are never additive deltas.
            const mergeCounts = (previous: Record<string, unknown>, incoming: Record<string, unknown>, keys: string[]) => {
              const merged = { ...previous };
              for (const key of keys) {
                const value = incoming[key];
                if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) continue;
                const prior = previous[key];
                merged[key] = next.usageStatus === "malformed" && typeof prior === "number"
                  ? Math.max(prior, value) : value;
              }
              return merged;
            };
            snapshot = {
              ...mergeCounts(snapshot, raw, ["prompt_tokens", "completion_tokens"]),
              prompt_tokens_details: mergeCounts(
                record(snapshot.prompt_tokens_details) ?? {},
                record(raw.prompt_tokens_details) ?? {},
                ["cached_tokens", "cache_write_tokens"],
              ),
            };
            accounting = parseUsage(snapshot);
            // Old counters are useful lower bounds, not evidence that the
            // final snapshot supplied all of this request's usage.
            if (next.usageStatus !== "measured" && accounting.usageStatus === "measured") {
              accounting.usageStatus = "partial";
            }
          }

        }
        const choices = data.choices;
        const first = Array.isArray(choices) ? record(choices[0]) : undefined;
        const delta = record(first?.delta);
        return typeof delta?.content === "string" ? { text: delta.content } : undefined;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (done && buffer) { lines.push(buffer); buffer = ""; }
          for (const line of lines) {
            const chunk = parseLine(line);
            if (chunk) {
              yield chunk;
              if (chunk.done) return;
            }
          }
          if (done) break;
        }
      } catch (cause) {
        const error = new ClaudeClientError(
          cause instanceof Error ? cause.message : "OpenAI stream interrupted",
          "network", true,
        );
        error.tokenUsage = accounting.tokenUsage;
        error.usageStatus = terminal(false).usageStatus;
        throw error;
      } finally {
        reader.releaseLock();
      }

      yield terminal(false);
    },
  };
}
