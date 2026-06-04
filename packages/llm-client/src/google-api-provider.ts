/**
 * Google Gemini API provider — calls the Gemini REST API via native fetch.
 *
 * Implements the generic {@link LLMProvider} interface for the "google" vendor
 * in "api" mode. Uses the Generative Language API:
 *
 * - `POST /v1beta/models/{model}:generateContent?key={apiKey}` for completions
 * - `POST /v1beta/models/{model}:streamGenerateContent?key={apiKey}&alt=sse` for streaming
 * - `GET /v1beta/models?key={apiKey}` for auth validation
 *
 * ## Model validation
 *
 * At factory construction time, the model ID (when provided) is validated
 * against the Gemini model prefix (`gemini-`). Non-Gemini model IDs are
 * rejected immediately with a `ClaudeClientError` reason `"not-found"`.
 *
 * ## Error handling
 *
 * Errors are classified into categories (auth, timeout, rate-limit, unknown)
 * matching the shared {@link ErrorReason} enum. Rate-limit (429) and quota
 * exhaustion (RESOURCE_EXHAUSTED) errors map to `"rate-limit"`.
 *
 * ## Dependencies
 *
 * Uses native `fetch` (Node 18+) — no Google SDK required.
 */

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";
import { ClaudeClientError } from "./types.js";
import type { LLMProvider, ProviderInfo, StreamChunk } from "./provider-interface.js";
import type { GoogleConfig } from "./llm-types.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-pro";

/** Prefix all valid Gemini model IDs must start with. */
const GEMINI_MODEL_PREFIX = "gemini-";

// ── Options ───────────────────────────────────────────────────────────────

/** Options for creating the Google Gemini API provider. */
export interface GoogleApiProviderOptions {
  /** Google Gemini configuration section from `.n-dx.json`. */
  googleConfig?: GoogleConfig;
  /** Environment variable name for API key fallback (default: "GOOGLE_API_KEY"). */
  apiKeyEnv?: string;
  /** Maximum number of retries for transient failures (default: 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum response tokens (default: 8192). */
  maxOutputTokens?: number;
}

// ── Token parsing ─────────────────────────────────────────────────────────

/**
 * Parse token usage from a Gemini API response `usageMetadata` object.
 *
 * Gemini uses `promptTokenCount` / `candidatesTokenCount` at the top level.
 * Maps to the shared TokenUsage shape: `promptTokenCount` → `input`,
 * `candidatesTokenCount` → `output`.
 *
 * Always returns a TokenUsage — missing numeric fields default to 0.
 */
export function parseGeminiTokenUsage(
  raw: Record<string, unknown>,
): TokenUsage {
  const input = typeof raw.promptTokenCount === "number" ? raw.promptTokenCount : 0;
  const output = typeof raw.candidatesTokenCount === "number" ? raw.candidatesTokenCount : 0;
  return { input, output };
}

// ── Auth resolution ───────────────────────────────────────────────────────

/**
 * Resolve the Google API key from config or environment.
 *
 * Priority:
 * 1. `googleConfig.api_key` from unified config (`.n-dx.json`)
 * 2. Environment variable (default: `GOOGLE_API_KEY`)
 *
 * @returns The resolved API key, or undefined if not found.
 */
export function resolveGoogleApiKey(
  googleConfig?: GoogleConfig,
  apiKeyEnv = "GOOGLE_API_KEY",
): string | undefined {
  return googleConfig?.api_key ?? process.env[apiKeyEnv];
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
  if (status === 404) {
    throw new ClaudeClientError(message, "not-found", false);
  }
  throw new ClaudeClientError(message, "unknown", false);
}

/** Build the base URL for Gemini API requests. */
function resolveBaseUrl(googleConfig?: GoogleConfig): string {
  return googleConfig?.api_endpoint ?? DEFAULT_BASE_URL;
}

/**
 * Extract text from a Gemini API response candidate array.
 *
 * Returns empty string when no candidates or parts are present.
 */
function extractTextFromCandidates(
  candidates: Array<Record<string, unknown>> | undefined,
): string {
  if (!candidates || candidates.length === 0) return "";
  const content = candidates[0].content as Record<string, unknown> | undefined;
  if (!content) return "";
  const parts = content.parts as Array<Record<string, unknown>> | undefined;
  if (!parts || parts.length === 0) return "";
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");
  return text;
}

/**
 * Validate a Gemini model ID.
 *
 * Accepts model IDs starting with "gemini-" (e.g. "gemini-2.5-pro",
 * "gemini-2.0-flash"). Rejects IDs that belong to other vendors
 * (e.g. "gpt-4o", "claude-sonnet-4-6").
 *
 * @throws {ClaudeClientError} with reason "not-found" when the model ID
 *   is non-empty and does not start with "gemini-".
 */
export function validateGeminiModelId(model: string): void {
  if (model && !model.startsWith(GEMINI_MODEL_PREFIX)) {
    throw new ClaudeClientError(
      `Invalid Gemini model ID "${model}". Gemini model IDs must start with "${GEMINI_MODEL_PREFIX}" (e.g. "gemini-2.5-pro", "gemini-2.0-flash").`,
      "not-found",
      false,
    );
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a Google Gemini API provider that implements the {@link LLMProvider} interface.
 *
 * Uses native `fetch` to call the Generative Language REST API.
 * Supports both blocking completions and streaming.
 *
 * @throws {ClaudeClientError} with reason "auth" if no API key is available.
 * @throws {ClaudeClientError} with reason "not-found" if the model ID is not a
 *   valid Gemini model (i.e., does not start with "gemini-").
 */
export function createGoogleApiProvider(
  options: GoogleApiProviderOptions = {},
): LLMProvider {
  const apiKeyEnv = options.apiKeyEnv ?? "GOOGLE_API_KEY";
  const googleConfig = options.googleConfig;
  const apiKey = resolveGoogleApiKey(googleConfig, apiKeyEnv);

  if (!apiKey) {
    throw new ClaudeClientError(
      `Google API key not found. Set it via 'n-dx config google.api_key <key>' or the ${apiKeyEnv} environment variable.`,
      "auth",
      false,
    );
  }

  const defaultModel = googleConfig?.model ?? DEFAULT_MODEL;
  // Validate the configured default model at construction time.
  validateGeminiModelId(defaultModel);

  const baseUrl = resolveBaseUrl(googleConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const info: ProviderInfo = {
    vendor: "google",
    mode: "api",
    model: defaultModel,
    capabilities: ["streaming"],
  };

  /**
   * Build the full request URL for a given model and action.
   *
   * Appends the API key as a query parameter (required by the Gemini REST API).
   */
  function buildUrl(model: string, action: "generateContent" | "streamGenerateContent"): string {
    const base = `${baseUrl}/models/${encodeURIComponent(model)}:${action}?key=${apiKey}`;
    return action === "streamGenerateContent" ? `${base}&alt=sse` : base;
  }

  /**
   * Build the JSON request body for a completion or streaming request.
   */
  function buildBody(prompt: string): string {
    return JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens },
    });
  }

  return {
    info,

    async validateAuth(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/models?key=${apiKey}`, {
          method: "GET",
        });
        if (response.status === 401 || response.status === 403) {
          return false;
        }
        if (!response.ok) {
          throw new ClaudeClientError(
            `Gemini models endpoint returned ${response.status}`,
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
      // Validate at call time as well — callers can pass any model string.
      validateGeminiModelId(model);

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(buildUrl(model, "generateContent"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: buildBody(request.prompt),
          });

          if (!response.ok) {
            const body = await response.text();
            const message = `Gemini API error ${response.status}: ${body}`;

            if (response.status === 401 || response.status === 403) {
              throw new ClaudeClientError(message, "auth", false);
            }
            if (response.status === 404) {
              throw new ClaudeClientError(message, "not-found", false);
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
          const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
          const text = extractTextFromCandidates(candidates);

          const tokenUsage = data.usageMetadata
            ? parseGeminiTokenUsage(data.usageMetadata as Record<string, unknown>)
            : undefined;

          return { text, tokenUsage };
        } catch (err) {
          if (err instanceof ClaudeClientError) {
            throw err;
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
      validateGeminiModelId(model);

      const response = await fetch(buildUrl(model, "streamGenerateContent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBody(request.prompt),
      });

      if (!response.ok) {
        const body = await response.text();
        classifyAndThrow(
          response.status,
          `Gemini API stream error ${response.status}: ${body}`,
        );
      }

      if (!response.body) {
        throw new ClaudeClientError(
          "Gemini API returned no response body for stream",
          "unknown",
          false,
        );
      }

      // Parse SSE stream — each event is a data: {...} line containing a
      // partial or complete Gemini response object.
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

            if (trimmed.startsWith("data: ")) {
              const raw = trimmed.slice(6).trim();
              if (!raw || raw === "[DONE]") {
                yield { done: true, usage: totalUsage };
                return;
              }
              try {
                const data = JSON.parse(raw) as Record<string, unknown>;
                const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
                const chunkText = extractTextFromCandidates(candidates);
                if (chunkText) {
                  yield { text: chunkText };
                }
                if (data.usageMetadata) {
                  totalUsage = parseGeminiTokenUsage(
                    data.usageMetadata as Record<string, unknown>,
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
          if (trimmed.startsWith("data: ")) {
            const raw = trimmed.slice(6).trim();
            if (raw && raw !== "[DONE]") {
              try {
                const data = JSON.parse(raw) as Record<string, unknown>;
                const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
                const chunkText = extractTextFromCandidates(candidates);
                if (chunkText) {
                  yield { text: chunkText };
                }
                if (data.usageMetadata) {
                  totalUsage = parseGeminiTokenUsage(
                    data.usageMetadata as Record<string, unknown>,
                  );
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { done: true, usage: totalUsage };
    },
  };
}
