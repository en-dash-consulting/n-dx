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
 * Transient failures — a refused or dropped connection, and 429/500/502/503 —
 * are retried with capped exponential backoff (`llm.local.maxRetries`,
 * `llm.local.retryBaseDelayMs`, `llm.local.retryMaxDelayMs`; by default about
 * two minutes, enough for LM Studio to reload a model). A connection that is
 * still down after that surfaces as a retryable `ClaudeClientError` with reason
 * `"network"` naming the server, the attempts made and the settings to raise.
 * A request that hits `llm.local.timeoutMs` is not retried here; it surfaces
 * as reason `"timeout"`.
 *
 * Completions are always requested streamed (see {@link fetchLocalCompletion}):
 * Node's fetch gives up after 300 s without response headers, and LM Studio
 * sends none for a non-streamed completion until generation ends — so a slow
 * model's turn died after five minutes whatever `llm.local.timeoutMs` said.
 * Streamed, the headers come at once; the chunks are assembled back into the
 * non-streamed response, and `llm.local.timeoutMs` bounds the whole read.
 *
 * A 400/500 saying the model produced malformed output (a broken tool call or
 * channel — "does not match the expected … format") is the model's mistake, not
 * the request's: the same request is sent again, up to
 * `llm.local.maxFormatRetries` times (default 3).
 *
 * @see {@link createOpenAiApiProvider} in `openai-api-provider.ts` for the cloud alternative
 */

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";
import { ClaudeClientError } from "./types.js";
import { LLM_VENDOR, type LLMProvider, type ProviderInfo, type StreamChunk } from "./provider-interface.js";
import type { LocalConfig } from "./llm-types.js";
import { parseOpenAiTokenUsage } from "./openai-api-provider.js";
import { CLASSIFY_WINDOW } from "./llm-error-classifier.js";
import { DEFAULT_LOCAL_HOST, DEFAULT_LOCAL_PORT, describeLocalEndpointProblem } from "./local-endpoint.js";
import { assembleLocalChatStream, readSseData } from "./local-chat-stream.js";

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503]);
/**
 * Retry defaults for the local server. A dropped connection to LM Studio is
 * usually a model reload or a short server restart, which outlasts seconds:
 * 6 retries at 2, 4, 8, 16, 32 and 60 s wait about two minutes in all.
 */
export const DEFAULT_LOCAL_MAX_RETRIES = 6;
export const DEFAULT_LOCAL_RETRY_BASE_DELAY_MS = 2000;
export const DEFAULT_LOCAL_RETRY_MAX_DELAY_MS = 60_000;
/**
 * Resends of a turn the local server rejected because the model's output was
 * malformed (see {@link isLocalModelOutputError}). Sampling differs per
 * attempt, so a resend usually comes back well formed.
 */
export const DEFAULT_LOCAL_MAX_FORMAT_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 8192;
// Local inference can be slow; use a long timeout. Streaming is unaffected
// because the connection stays open as chunks arrive.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Options ───────────────────────────────────────────────────────────────

/** Options for creating the local API provider. */
export interface LocalApiProviderOptions {
  /** Local server configuration from `.n-dx.json`. */
  localConfig?: LocalConfig;
  /**
   * Maximum number of retries for transient failures — a refused or dropped
   * connection, or a 429/5xx. Defaults to `llm.local.maxRetries`, then
   * {@link DEFAULT_LOCAL_MAX_RETRIES}.
   */
  maxRetries?: number;
  /**
   * Base delay in ms for exponential backoff. Defaults to
   * `llm.local.retryBaseDelayMs`, then {@link DEFAULT_LOCAL_RETRY_BASE_DELAY_MS}.
   */
  baseDelayMs?: number;
  /**
   * Cap on one backoff delay in ms. Defaults to `llm.local.retryMaxDelayMs`,
   * then {@link DEFAULT_LOCAL_RETRY_MAX_DELAY_MS}.
   */
  maxDelayMs?: number;
  /**
   * Resends after the server reports malformed model output. Defaults to
   * `llm.local.maxFormatRetries`, then {@link DEFAULT_LOCAL_MAX_FORMAT_RETRIES}.
   */
  maxFormatRetries?: number;
  /** Wait between attempts. Tests replace it; defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
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

// ── Connection retries ───────────────────────────────────────────────────

/** How long, and how often, a local request is retried after a transient failure. */
export interface LocalRetryPolicy {
  /** Retries after the first attempt. 0 disables retrying. */
  maxRetries: number;
  /** First backoff delay in ms; each later one doubles. */
  baseDelayMs: number;
  /** Cap on one backoff delay in ms. */
  maxDelayMs: number;
  /** Resends after malformed model output. 0 disables. */
  maxFormatRetries: number;
}

function pickNonNegative(...values: Array<number | undefined>): number | undefined {
  return values.find((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
}

/**
 * Resolve the retry policy for local requests.
 *
 * Precedence per field: explicit `overrides` → `llm.local.maxRetries` /
 * `retryBaseDelayMs` / `retryMaxDelayMs` / `maxFormatRetries` → the defaults
 * ({@link DEFAULT_LOCAL_MAX_RETRIES} etc.). A negative or non-numeric value is
 * skipped rather than trusted.
 */
export function resolveLocalRetryPolicy(
  localConfig?: LocalConfig,
  overrides: Partial<LocalRetryPolicy> = {},
): LocalRetryPolicy {
  const maxRetries = pickNonNegative(overrides.maxRetries, localConfig?.maxRetries) ?? DEFAULT_LOCAL_MAX_RETRIES;
  const baseDelayMs = pickNonNegative(overrides.baseDelayMs, localConfig?.retryBaseDelayMs)
    ?? DEFAULT_LOCAL_RETRY_BASE_DELAY_MS;
  const maxDelayMs = pickNonNegative(overrides.maxDelayMs, localConfig?.retryMaxDelayMs)
    ?? DEFAULT_LOCAL_RETRY_MAX_DELAY_MS;
  const maxFormatRetries = pickNonNegative(overrides.maxFormatRetries, localConfig?.maxFormatRetries)
    ?? DEFAULT_LOCAL_MAX_FORMAT_RETRIES;
  return {
    maxRetries: Math.floor(maxRetries),
    baseDelayMs,
    maxDelayMs: Math.max(maxDelayMs, 0),
    maxFormatRetries: Math.floor(maxFormatRetries),
  };
}

/** Backoff before retry number `attempt` (0-based): doubling, capped. */
function retryDelayMs(policy: LocalRetryPolicy, attempt: number): number {
  return Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
}

/** Error codes of a connection that failed or dropped, as Node and undici report them. */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_CLOSED",
]);

const NETWORK_ERROR_MESSAGE = /fetch failed|socket hang up|other side closed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET/i;

/**
 * True when `err` is a refused, reset or dropped connection — the failures a
 * local server shows while it restarts or reloads a model.
 *
 * Node's fetch rejects with `TypeError("fetch failed")` and puts the socket
 * error (`ECONNREFUSED`, `UND_ERR_SOCKET`, …) on `cause`, so the cause chain
 * is read too. A timeout of our own (`AbortError` / `TimeoutError`) is not a
 * network error: it keeps its own handling.
 */
export function isLocalNetworkError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const e = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (e.name === "AbortError" || e.name === "TimeoutError") return false;
    if (typeof e.code === "string" && NETWORK_ERROR_CODES.has(e.code)) return true;
    if (typeof e.message === "string" && NETWORK_ERROR_MESSAGE.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}

/** The innermost cause's message, which names the socket error. */
function describeNetworkError(err: unknown): string {
  const outer = (err as Error)?.message ?? String(err);
  const cause = (err as { cause?: { code?: unknown; message?: unknown } })?.cause;
  const detail = typeof cause?.code === "string" ? cause.code : typeof cause?.message === "string" ? cause.message : "";
  return detail && !outer.includes(detail) ? `${outer} (${detail})` : outer;
}

function describeWait(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 6_000) / 10} min` : `${Math.round(ms / 100) / 10}s`;
}

// ── Malformed model output ───────────────────────────────────────────────

/**
 * What a local server says when the *model's* output could not be parsed — a
 * tool call or channel in the wrong shape. Kept narrow on purpose: an ordinary
 * 400 (context length, a bad request body) must not be resent.
 */
const MODEL_OUTPUT_ERROR = new RegExp(
  [
    "does not match the expected",
    "model produced output",
    "produced output that",
    "invalid tool call",
    "failed to parse (?:the )?(?:tool|function|model|generated|output|input at pos)",
  ].join("|"),
  "i",
);

/**
 * True when an HTTP status and error body from the local server mean the
 * model produced malformed output (LM Studio: `Engine protocol predict stream
 * returned an error: … The model produced output that does not match the
 * expected peg-native format`). Only 400 and 500 qualify.
 */
export function isLocalModelOutputError(status: number, rawBody: string): boolean {
  if (status !== 400 && status !== 500) return false;
  return MODEL_OUTPUT_ERROR.test(rawBody.slice(0, CLASSIFY_WINDOW));
}

/** Options for {@link fetchLocalWithRetry} and {@link fetchLocalCompletion}. */
export interface LocalFetchOptions {
  /** The server's base URL, named in the error when retries run out. */
  baseUrl: string;
  /**
   * Per-attempt timeout in ms; 0 means none. {@link fetchLocalWithRetry}
   * clears it once headers arrive; {@link fetchLocalCompletion} holds it until
   * the whole streamed completion has been read.
   */
  timeoutMs: number;
  /** `llm.local.*` settings the retry policy is read from. */
  localConfig?: LocalConfig;
  /** Explicit retry settings, ahead of `localConfig`. */
  policy?: Partial<LocalRetryPolicy>;
  /** Told before each wait, so a caller can say why the run is pausing. */
  onRetry?: (notice: { attempt: number; maxRetries: number; delayMs: number; error: string }) => void;
  /** Told before each resend after malformed model output. */
  onFormatRetry?: (notice: { attempt: number; maxRetries: number; delayMs: number; error: string }) => void;
  /** Wait between attempts. Tests replace it; defaults to a timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What one attempt came back with: a response for the caller, or malformed model output to resend on. */
type LocalAttempt =
  | { response: Response }
  | { formatError: { status: number; rawBody: string } };

/**
 * Judge a 400/500 by its body: malformed model output is resent, anything else
 * goes back to the caller as an equivalent response (the body has been read).
 */
async function judgeErrorStatus(response: Response): Promise<LocalAttempt> {
  if (response.status !== 400 && response.status !== 500) return { response };
  const rawBody = await response.text().catch(() => "");
  if (isLocalModelOutputError(response.status, rawBody)) {
    return { formatError: { status: response.status, rawBody } };
  }
  return {
    response: new Response(rawBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}

/**
 * The attempt loop {@link fetchLocalWithRetry} and {@link fetchLocalCompletion}
 * share. `read` turns the fetched response into the attempt's outcome; with
 * `holdTimeout` it runs under the same `timeoutMs` abort as the fetch, so the
 * bound covers the whole body, and a connection dropped while it reads is
 * retried like a refused one.
 */
async function sendLocalWithRetry(
  url: string,
  init: RequestInit,
  options: LocalFetchOptions,
  read: (response: Response) => Promise<LocalAttempt>,
  holdTimeout: boolean,
): Promise<Response> {
  const policy = resolveLocalRetryPolicy(options.localConfig, options.policy ?? {});
  const sleep = options.sleep ?? defaultSleep;
  let networkAttempt = 0;
  let formatAttempt = 0;
  let waitedMs = 0;
  for (;;) {
    const abort = createTimeoutAbort(options.timeoutMs);
    let attempt: LocalAttempt;
    try {
      const response = await fetch(url, { ...init, ...(abort ? { signal: abort.signal } : {}) });
      if (!holdTimeout) abort?.clear();
      attempt = await read(response);
    } catch (err) {
      if (!isLocalNetworkError(err)) throw err;
      if (networkAttempt >= policy.maxRetries) {
        const attempts = networkAttempt + 1;
        throw new ClaudeClientError(
          `Cannot reach local server at ${options.baseUrl}: ${describeNetworkError(err)}. ` +
          `Gave up after ${attempts} attempt${attempts === 1 ? "" : "s"} over ${describeWait(waitedMs)}. ` +
          "Is LM Studio running with a model loaded? To wait longer for a restart or model reload, raise " +
          `llm.local.maxRetries (now ${policy.maxRetries}), llm.local.retryBaseDelayMs (now ${policy.baseDelayMs}) ` +
          `or llm.local.retryMaxDelayMs (now ${policy.maxDelayMs}), e.g. 'ndx config llm.local.maxRetries 10'.`,
          "network",
          true,
        );
      }
      const delayMs = retryDelayMs(policy, networkAttempt);
      networkAttempt++;
      options.onRetry?.({ attempt: networkAttempt, maxRetries: policy.maxRetries, delayMs, error: describeNetworkError(err) });
      await sleep(delayMs);
      waitedMs += delayMs;
      continue;
    } finally {
      abort?.clear();
    }

    if ("response" in attempt) return attempt.response;
    const error = parseLmStudioError(attempt.formatError.status, attempt.formatError.rawBody);
    if (formatAttempt >= policy.maxFormatRetries) {
      const attempts = formatAttempt + 1;
      throw new ClaudeClientError(
        `The local model at ${options.baseUrl} produced malformed output (a tool call or message the server ` +
        `could not parse) ${attempts} time${attempts === 1 ? "" : "s"} in a row: ${error}. ` +
        `Raise llm.local.maxFormatRetries (now ${policy.maxFormatRetries}) to resend it more often, ` +
        "e.g. 'ndx config llm.local.maxFormatRetries 6', or try a model that follows the tool-call format more reliably.",
        "unknown",
        false,
      );
    }
    // A short, fixed pause: the server is up, only the sample was bad.
    const delayMs = Math.min(policy.baseDelayMs, policy.maxDelayMs);
    formatAttempt++;
    options.onFormatRetry?.({ attempt: formatAttempt, maxRetries: policy.maxFormatRetries, delayMs, error });
    await sleep(delayMs);
  }
}

/**
 * `fetch` a local-server URL, retrying while the connection is refused or
 * dropped, and resending while the model's output comes back malformed.
 *
 * Network failures (see {@link isLocalNetworkError}) are retried on
 * `llm.local.maxRetries`; when those run out the error is a retryable
 * `ClaudeClientError` with reason `"network"`, naming the server, the attempts
 * made, how long they waited and the settings to raise — so a caller's own
 * retry policy (`hench.retry.*`) can still apply.
 *
 * A 400/500 whose body says the model produced malformed output (see
 * {@link isLocalModelOutputError}) is resent up to `llm.local.maxFormatRetries`
 * times after a short pause; when those run out the error names what happened
 * and the setting. Any other HTTP response is returned for the caller to judge.
 *
 * `timeoutMs` bounds the wait for headers and is then cleared, so a stream can
 * run as long as it keeps sending; hitting it is not retried — the abort's
 * `AbortError` is rethrown as it came. Used by the provider's `stream()`; a
 * completion read whole goes through {@link fetchLocalCompletion}.
 */
export async function fetchLocalWithRetry(
  url: string,
  init: RequestInit,
  options: LocalFetchOptions,
): Promise<Response> {
  return sendLocalWithRetry(url, init, options, judgeErrorStatus, false);
}

/**
 * The status a failure reported inside the stream is given. LM Studio answers
 * the same failures with a 400 when the request is not streamed (a context
 * overflow, malformed model output), so callers keep judging them as before.
 */
const IN_STREAM_ERROR_STATUS = 400;

/** True when the response is a server-sent event stream. */
function isEventStream(response: Response): boolean {
  const type = response.headers?.get?.("content-type") ?? "";
  return /text\/event-stream/i.test(type);
}

/** Read a streamed completion to its end and assemble it into the non-streamed response. */
async function readStreamedCompletion(response: Response): Promise<LocalAttempt> {
  if (!response.ok || !response.body || !isEventStream(response)) return judgeErrorStatus(response);
  const assembled = await assembleLocalChatStream(response.body);
  if ("error" in assembled) {
    if (isLocalModelOutputError(IN_STREAM_ERROR_STATUS, assembled.error)) {
      return { formatError: { status: IN_STREAM_ERROR_STATUS, rawBody: assembled.error } };
    }
    return {
      response: new Response(assembled.error, {
        status: IN_STREAM_ERROR_STATUS,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    };
  }
  return {
    response: new Response(JSON.stringify(assembled.completion), {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
    }),
  };
}

/** Options for {@link fetchLocalCompletion}. */
export interface LocalCompletionOptions extends LocalFetchOptions {
  /**
   * `false` sends once: no connection retries (the fetch error is rethrown as
   * it came) and no malformed-output resends (that error comes back as a 400
   * response). For best-effort calls such as hench's context summarizer and
   * verifier. Default `true`.
   */
  resend?: boolean;
}

/**
 * POST a chat completion to the local server, streamed, and return it as the
 * non-streamed response: `response.json()` is the usual
 * `{ choices: [{ message, finish_reason }], usage }`.
 *
 * The request asks for `stream: true`, and for `stream_options.include_usage`
 * so the token counts still arrive (a server that ignores it sends no `usage`,
 * as a non-streamed reply without one would). LM Studio sends a streamed
 * response's headers at once, so Node's 300 s wait for headers — which a slow
 * non-streamed completion runs into — no longer applies. The chunks are
 * assembled by `assembleLocalChatStream`: content and reasoning concatenated,
 * tool calls merged by index, the last `finish_reason`, the usage chunk. A
 * server that answers with plain JSON is passed through unchanged.
 *
 * `timeoutMs` (`llm.local.timeoutMs`, 0 = none) bounds the whole request, from
 * sending to the last chunk, as it did for a non-streamed completion; hitting
 * it rethrows the abort's `AbortError` and is not retried. A connection that
 * drops mid-stream is retried like a refused one. A failure the server reports
 * inside the stream comes back as a 400 response carrying that error body —
 * or, when it is malformed model output, is resent on
 * `llm.local.maxFormatRetries` exactly like its HTTP 400 form (see
 * {@link fetchLocalWithRetry}).
 *
 * Shared by the provider's blocking path and by hench's local tool loop,
 * context summarizer and verifier, which build their own chat requests.
 */
export async function fetchLocalCompletion(
  url: string,
  body: Record<string, unknown>,
  options: LocalCompletionOptions,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
  };
  if (options.resend !== false) {
    return sendLocalWithRetry(url, init, options, readStreamedCompletion, true);
  }
  const abort = createTimeoutAbort(options.timeoutMs);
  try {
    const response = await fetch(url, { ...init, ...(abort ? { signal: abort.signal } : {}) });
    const attempt = await readStreamedCompletion(response);
    if ("response" in attempt) return attempt.response;
    return new Response(attempt.formatError.rawBody, {
      status: attempt.formatError.status,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    abort?.clear();
  }
}

/**
 * Build the base URL from host and port config.
 *
 * The saved values are spliced straight into the URL, so a hand-edited
 * `.n-dx.json` whose host carries a path or credentials, or whose port is a
 * string, is refused here — the same rule the dashboard and `ndx config`
 * apply — rather than reaching `fetch` as a request to somewhere else. An
 * absent or cleared key (undefined, null, or an empty host) takes the default;
 * a present value is judged as written, so a port saved as `"1234"` is an
 * error and not a silent 1234.
 */
function resolveBaseUrl(localConfig?: LocalConfig): string {
  const savedHost: unknown = localConfig?.host;
  const savedPort: unknown = localConfig?.port;
  const host = savedHost == null || savedHost === "" ? DEFAULT_LOCAL_HOST : savedHost;
  const port = savedPort == null ? DEFAULT_LOCAL_PORT : savedPort;
  const problem = describeLocalEndpointProblem(host, port);
  if (problem) {
    throw new ClaudeClientError(
      `${problem} Fix llm.local.host / llm.local.port in .n-dx.json (ndx config llm.local.host <host>).`,
      "unknown",
      false,
    );
  }
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
    if (typeof errObj === "string") {
      // LM Studio's engine errors: { error: "Engine protocol … returned an error: …" }
      innerMessage = errObj;
    } else if (errObj && typeof errObj === "object") {
      const m = (errObj as Record<string, unknown>).message;
      if (typeof m === "string") innerMessage = m;
    } else if (typeof parsed.message === "string") {
      innerMessage = parsed.message;
    }
  } catch {
    // Not JSON — fall through to raw body
  }

  // The body is the whole `response.text()`, and the signatures below are
  // tested before the 300-character truncation at the end, so they read a
  // bounded head of it. What they look for sits at the start of an LM Studio
  // message; nothing kilobytes in distinguishes one error from another.
  const msg = (innerMessage ?? rawBody).slice(0, CLASSIFY_WINDOW);

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

  // No model loaded. The words of "model … not … available" sit within one
  // sentence, so the gaps are bounded: with `.*` the pattern backtracked
  // cubically, and a 50 kB body of "model not " took 100 s to fail to match.
  if (/no model (is )?loaded|model not found|model[^\n]{0,200}?not[^\n]{0,200}?available/i.test(msg)) {
    return `No model loaded in LM Studio — open LM Studio and load a model before running ndx work.`;
  }

  // Generic: prefer the extracted message over the raw JSON blob
  if (innerMessage) return `Local API error ${status}: ${innerMessage}`;

  // Last resort: truncate raw body so it stays readable
  const truncated = rawBody.length > 300 ? rawBody.slice(0, 300) + "…" : rawBody;
  return `Local API error ${status}: ${truncated}`;
}

/**
 * The error a failed local request surfaces as. A `ClaudeClientError` (the
 * exhausted network retries among them) passes through; a timeout of our own
 * becomes reason `"timeout"`; anything else is not known to be transient.
 */
function toLocalClientError(err: unknown, timeoutMs: number): ClaudeClientError {
  if (err instanceof ClaudeClientError) return err;
  if ((err as Error)?.name === "AbortError") {
    return new ClaudeClientError(
      `Local API request timed out after ${describeTimeout(timeoutMs)}. The model may still be loading or generating — ` +
      `raise the limit with 'ndx config llm.local.timeoutMs <ms>' (e.g. 7200000 for 2 h, or 0 for no limit).`,
      "timeout",
      true,
    );
  }
  if (isLocalNetworkError(err)) {
    return new ClaudeClientError(describeNetworkError(err), "network", true);
  }
  return new ClaudeClientError((err as Error)?.message ?? "Unknown error", "unknown", false);
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
  const policy = resolveLocalRetryPolicy(localConfig, {
    maxRetries: options.maxRetries,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    maxFormatRetries: options.maxFormatRetries,
  });
  const maxRetries = policy.maxRetries;
  const sleep = options.sleep ?? defaultSleep;
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
      const body: Record<string, unknown> = {
        max_tokens: maxTokens,
        messages: [{ role: "user", content: request.prompt }],
      };
      // Only include model when non-empty — LM Studio accepts omitted model
      // and uses the currently loaded one.
      if (model) body.model = model;

      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          // Streamed and assembled, so the headers come at once; network
          // failures are retried inside; timeoutMs bounds the whole read, and
          // 0 disables the abort entirely (llm.local.timeoutMs 0).
          response = await fetchLocalCompletion(
            `${baseUrl}/chat/completions`,
            body,
            { baseUrl, timeoutMs, policy, sleep },
            headers,
          );
        } catch (err) {
          throw toLocalClientError(err, timeoutMs);
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
            await sleep(retryDelayMs(policy, attempt));
            continue;
          }
          if (RETRY_STATUS_CODES.has(response.status)) {
            throw new ClaudeClientError(message, "rate-limit", true);
          }
          throw new ClaudeClientError(message, "unknown", false);
        }

        let data: Record<string, unknown>;
        try {
          data = await response.json() as Record<string, unknown>;
        } catch (err) {
          // The connection dropped while the body was arriving: same as a
          // refused one, so wait and ask again.
          if (isLocalNetworkError(err) && attempt < maxRetries) {
            await sleep(retryDelayMs(policy, attempt));
            continue;
          }
          throw toLocalClientError(err, timeoutMs);
        }
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
      }
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
      // timeoutMs === 0 disables even the connection-setup bound. A refused or
      // dropped connection is retried before any chunk is yielded.
      let response: Response;
      try {
        response = await fetchLocalWithRetry(
          `${baseUrl}/chat/completions`,
          { method: "POST", headers, body: JSON.stringify(body) },
          { baseUrl, timeoutMs, policy, sleep },
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new ClaudeClientError(
            `Local API stream connection timed out after ${describeTimeout(timeoutMs)} — the server did not begin responding. ` +
            `Raise the limit with 'ndx config llm.local.timeoutMs <ms>' (0 = no limit).`,
            "timeout",
            true,
          );
        }
        throw toLocalClientError(err, timeoutMs);
      }


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
      let totalUsage: TokenUsage | undefined;

      for await (const { data: line } of readSseData(response.body)) {
        if (line === "[DONE]") {
          yield { done: true, usage: totalUsage };
          return;
        }
        try {
          const data = JSON.parse(line) as Record<string, unknown>;
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

      yield { done: true, usage: totalUsage };
    },
  };
}
