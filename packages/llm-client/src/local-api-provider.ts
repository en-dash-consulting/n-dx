/**
 * Local API provider — calls an OpenAI-compatible local server via native fetch.
 *
 * Designed for use with LM Studio (default: http://localhost:1234/v1) and any
 * other server that speaks the OpenAI Chat Completions API format. No API key
 * is required by default — authentication is optional.
 *
 * Implements the generic {@link LLMProvider} interface for the "local" vendor.
 *
 * ## Configuration (in `.n-dx.json`)
 *
 * ```json
 * {
 *   "llm": {
 *     "vendor": "local",
 *     "local": {
 *       "host": "localhost",
 *       "port": 1234,
 *       "model": "lmstudio-community/Qwen2.5-14B-Instruct-GGUF"
 *     }
 *   }
 * }
 * ```
 *
 * When `model` is not set, LM Studio uses whichever model is currently loaded
 * in its UI.
 *
 * ## Error handling
 *
 * Transient failures (429, 500, 502, 503) are retried with exponential backoff.
 * Connection errors surface as `ClaudeClientError` with reason `"unknown"`.
 *
 * @see {@link createOpenAiApiProvider} in `openai-api-provider.ts` for the cloud alternative
 */

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";
import { ClaudeClientError } from "./types.js";
import { LLM_VENDOR, type LLMProvider, type ProviderInfo, type StreamChunk } from "./provider-interface.js";
import type { LocalConfig } from "./llm-types.js";
import { parseOpenAiTokenUsage } from "./openai-api-provider.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 1234;
// Local inference can be slow; use a long timeout. Streaming is unaffected
// because the connection stays open as chunks arrive.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Options ───────────────────────────────────────────────────────────────

/** Options for creating the local API provider. */
export interface LocalApiProviderOptions {
  /** Local server configuration from `.n-dx.json`. */
  localConfig?: LocalConfig;
  /** Maximum number of retries for transient failures (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum response tokens (default: 8192). */
  maxTokens?: number;
  /**
   * Request timeout in milliseconds for non-streaming completions.
   *
   * Defaults to `llm.local.timeoutMs` from `.n-dx.json`, then 300000 (5 min).
   * `0` disables the timeout entirely. Local inference can be slow; set higher
   * for very large models. Streaming completions only apply this to connection
   * setup — the connection then stays open as chunks arrive.
   */
  timeoutMs?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the per-request timeout for local completions.
 *
 * Precedence: explicit `override` (a caller-supplied option) → `llm.local.timeoutMs`
 * from `.n-dx.json` → {@link DEFAULT_TIMEOUT_MS} (5 min).
 *
 * A resolved value of `0` means **no timeout** — the request runs until the
 * local server responds or the connection drops. This mirrors the `0 = unlimited`
 * convention used by `cli.timeoutMs`, and is the setting to use for very slow
 * local models. Note that the CLI-level `cli.timeoutMs` setting does *not* reach
 * this layer: it bounds the whole command, not the individual HTTP request.
 *
 * Exported so that other local-vendor call sites (e.g. hench's local tool loop)
 * resolve the same value instead of hardcoding their own.
 */
export function resolveLocalTimeoutMs(
  localConfig?: LocalConfig,
  override?: number,
): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return override;
  }
  const configured = localConfig?.timeoutMs;
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Create an abort controller wired to `timeoutMs`, or `null` when the timeout
 * is disabled (`0`). Callers must invoke `clear()` in a `finally` block so a
 * completed request does not leave a pending timer holding the event loop open.
 */
function createTimeoutAbort(timeoutMs: number): { signal: AbortSignal; clear: () => void } | null {
  if (timeoutMs <= 0) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  return { signal: abort.signal, clear: () => clearTimeout(timer) };
}

/** Human-readable rendering of a timeout for error messages. */
function describeTimeout(timeoutMs: number): string {
  if (timeoutMs >= 60_000) {
    const minutes = Math.round(timeoutMs / 60_000);
    return `${minutes} min`;
  }
  return `${timeoutMs / 1000}s`;
}

/** Build the base URL from host and port config. */
function resolveBaseUrl(localConfig?: LocalConfig): string {
  const host = localConfig?.host ?? DEFAULT_HOST;
  const port = localConfig?.port ?? DEFAULT_PORT;
  return `http://${host}:${port}/v1`;
}

/**
 * Parse an LM Studio / OpenAI-compat error response body into a readable message.
 *
 * LM Studio wraps its errors in `{ error: { message, code, type } }`.
 * This function extracts the inner message and rewrites known patterns into
 * actionable guidance (e.g. context-window overflow → "increase Context Length").
 *
 * Exported so that consumers (e.g. the hench local tool loop) can reuse the
 * same error formatting instead of truncating raw JSON blobs.
 */
export function parseLmStudioError(status: number, rawBody: string): string {
  let innerMessage: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    // LM Studio / OpenAI: { error: { message: "..." } }
    const errObj = parsed.error;
    if (errObj && typeof errObj === "object") {
      const m = (errObj as Record<string, unknown>).message;
      if (typeof m === "string") innerMessage = m;
    } else if (typeof parsed.message === "string") {
      innerMessage = parsed.message;
    }
  } catch {
    // Not JSON — fall through to raw body
  }

  const msg = innerMessage ?? rawBody;

  // ── Known patterns → actionable messages ────────────────────────────────

  // Context-window overflow: "request (N tokens) exceeds the available context size (M tokens)"
  const ctxMatch = msg.match(
    /request \(([\d,]+) tokens?\) exceeds the available context size \(([\d,]+) tokens?\)/i,
  );
  if (ctxMatch) {
    const requested = parseInt(ctxMatch[1].replace(/,/g, ""), 10).toLocaleString();
    const available  = parseInt(ctxMatch[2].replace(/,/g, ""), 10).toLocaleString();
    return (
      `Context window too small — the brief was ${requested} tokens but LM Studio ` +
      `is configured to ${available} tokens.\n` +
      `Fix: open LM Studio → select the model → increase "Context Length" to 32 768 or higher.`
    );
  }

  // No model loaded
  if (/no model (is )?loaded|model not found|model.*not.*available/i.test(msg)) {
    return `No model loaded in LM Studio — open LM Studio and load a model before running ndx work.`;
  }

  // Generic: prefer the extracted message over the raw JSON blob
  if (innerMessage) return `Local API error ${status}: ${innerMessage}`;

  // Last resort: truncate raw body so it stays readable
  const truncated = rawBody.length > 300 ? rawBody.slice(0, 300) + "…" : rawBody;
  return `Local API error ${status}: ${truncated}`;
}

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

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a local API provider that implements the {@link LLMProvider} interface.
 *
 * Uses native `fetch` to call an OpenAI-compatible local server (e.g. LM Studio).
 * No API key is required. Supports both blocking completions and streaming.
 */
export function createLocalApiProvider(
  options: LocalApiProviderOptions = {},
): LLMProvider {
  const localConfig = options.localConfig;
  const baseUrl = resolveBaseUrl(localConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = resolveLocalTimeoutMs(localConfig, options.timeoutMs);
  // Empty string is intentional: LM Studio uses whichever model is loaded.
  const defaultModel = localConfig?.model ?? "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const info: ProviderInfo = {
    vendor: LLM_VENDOR.LOCAL,
    mode: "api",
    ...(defaultModel ? { model: defaultModel } : {}),
    capabilities: ["streaming"],
  };

  return {
    info,

    async validateAuth(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers,
        });
        // A 200 from /v1/models confirms the server is up and reachable.
        // Non-200 (e.g. 401 if the user configured auth) returns false.
        return response.ok;
      } catch {
        return false;
      }
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const model = request.model || defaultModel;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const body: Record<string, unknown> = {
            max_tokens: maxTokens,
            messages: [{ role: "user", content: request.prompt }],
          };
          // Only include model when non-empty — LM Studio accepts omitted model
          // and uses the currently loaded one.
          if (model) body.model = model;

          // timeoutMs === 0 disables the abort entirely (llm.local.timeoutMs 0).
          const abort = createTimeoutAbort(timeoutMs);
          let response: Response;
          try {
            response = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              ...(abort ? { signal: abort.signal } : {}),
            });
          } finally {
            abort?.clear();
          }

          if (!response.ok) {
            const rawBody = await response.text();
            const message = parseLmStudioError(response.status, rawBody);

            if (response.status === 401 || response.status === 403) {
              throw new ClaudeClientError(message, "auth", false);
            }
            if (response.status === 408) {
              throw new ClaudeClientError(message, "timeout", true);
            }
            if (RETRY_STATUS_CODES.has(response.status) && attempt < maxRetries) {
              const delay = baseDelayMs * 2 ** attempt;
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
            if (RETRY_STATUS_CODES.has(response.status)) {
              throw new ClaudeClientError(message, "rate-limit", true);
            }
            throw new ClaudeClientError(message, "unknown", false);
          }

          const data = await response.json() as Record<string, unknown>;
          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          let text = "";

          if (choices && choices.length > 0) {
            const msg = choices[0].message as Record<string, unknown> | undefined;
            if (msg && typeof msg.content === "string") {
              text = msg.content;
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
          // AbortError means the timeout fired
          if ((err as Error).name === "AbortError") {
            throw new ClaudeClientError(
              `Local API request timed out after ${describeTimeout(timeoutMs)}. The model may still be loading or generating — ` +
              `raise the limit with 'ndx config llm.local.timeoutMs <ms>' (e.g. 7200000 for 2 h, or 0 for no limit).`,
              "timeout",
              true,
            );
          }
          lastError = err as Error;

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

      const body: Record<string, unknown> = {
        max_tokens: maxTokens,
        messages: [{ role: "user", content: request.prompt }],
        stream: true,
      };
      if (model) body.model = model;

      // Timeout only covers the connection setup; once headers arrive the
      // controller is cleared so the stream itself can run indefinitely.
      // timeoutMs === 0 disables even the connection-setup bound.
      const streamAbort = createTimeoutAbort(timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          ...(streamAbort ? { signal: streamAbort.signal } : {}),
        });
      } catch (err) {
        streamAbort?.clear();
        if ((err as Error).name === "AbortError") {
          throw new ClaudeClientError(
            `Local API stream connection timed out after ${describeTimeout(timeoutMs)} — the server did not begin responding. ` +
            `Raise the limit with 'ndx config llm.local.timeoutMs <ms>' (0 = no limit).`,
            "timeout",
            true,
          );
        }
        throw new ClaudeClientError((err as Error).message ?? "Unknown error", "unknown", false);
      }
      streamAbort?.clear();

      if (!response.ok) {
        const rawBody = await response.text();
        classifyAndThrow(response.status, parseLmStudioError(response.status, rawBody));
      }

      if (!response.body) {
        throw new ClaudeClientError(
          "Local API returned no response body for stream",
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

        if (buffer.trim() === "data: [DONE]") {
          yield { done: true, usage: totalUsage };
          return;
        }
      } finally {
        reader.releaseLock();
      }

      yield { done: true, usage: totalUsage };
    },
  };
}
