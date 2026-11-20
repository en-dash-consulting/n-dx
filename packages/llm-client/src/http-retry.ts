/**
 * HTTP plumbing shared by the fetch-based API providers (OpenAI, Gemini and
 * the local OpenAI-compatible server): which statuses are transient, the
 * error a non-OK status becomes, and the retrying POST the OpenAI and Gemini
 * providers send a completion with.
 *
 * The Anthropic provider (`api-provider.ts`) goes through the SDK and keeps
 * its own status set, which adds Anthropic's 529 "overloaded".
 */

import { ClaudeClientError } from "./types.js";

/** Statuses retried with exponential backoff: rate limiting and transient server errors. */
export const RETRY_STATUS_CODES: ReadonlySet<number> = new Set([429, 500, 502, 503]);

/**
 * Throw the error a non-OK status means: 401 or 403 is `auth`, 408 a
 * retryable `timeout`, a {@link RETRY_STATUS_CODES} status a retryable
 * `rate-limit`, anything else `unknown`.
 */
export function throwHttpStatusError(status: number, message: string): never {
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

/** The wait before retry `attempt` (zero-based): `baseDelayMs`, doubled each attempt. */
function backoff(baseDelayMs: number, attempt: number): Promise<void> {
  const delay = baseDelayMs * 2 ** attempt;
  return new Promise((r) => setTimeout(r, delay));
}

/** Options for {@link postJsonWithRetries}. */
export interface PostJsonWithRetriesOptions<T> {
  /**
   * The request URL and body, built again inside each attempt, so a throw
   * while building one is retried like a network failure.
   */
  url: () => string;
  body: () => string;
  headers: Record<string, string>;
  /** Retries after the first attempt. */
  maxRetries: number;
  /** Delay before the first retry; each later retry waits twice as long. */
  baseDelayMs: number;
  /**
   * Throw the error for a non-OK response that is not retried: any status
   * outside {@link RETRY_STATUS_CODES}, or one inside it on the last attempt.
   */
  throwForStatus: (status: number, body: string) => never;
  /** Read the parsed JSON of an OK response. */
  read: (data: Record<string, unknown>) => T;
}

/**
 * POST a JSON request and read the JSON response, retrying with exponential
 * backoff.
 *
 * A {@link RETRY_STATUS_CODES} status is retried while attempts remain; any
 * other non-OK status goes to `throwForStatus`. A `ClaudeClientError` is never
 * retried. Any other failure — the network, a body that is not JSON, `read`
 * throwing — is retried while attempts remain, then surfaces as a
 * `ClaudeClientError` of reason `unknown` carrying its message.
 */
export async function postJsonWithRetries<T>(options: PostJsonWithRetriesOptions<T>): Promise<T> {
  const { headers, maxRetries, baseDelayMs } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(options.url(), {
        method: "POST",
        headers,
        body: options.body(),
      });

      if (!response.ok) {
        const body = await response.text();
        if (RETRY_STATUS_CODES.has(response.status) && attempt < maxRetries) {
          await backoff(baseDelayMs, attempt);
          continue;
        }
        options.throwForStatus(response.status, body);
      }

      return options.read(await response.json() as Record<string, unknown>);
    } catch (err) {
      if (err instanceof ClaudeClientError) {
        throw err;
      }
      lastError = err as Error;

      // Network/fetch errors may be transient
      if (attempt < maxRetries) {
        await backoff(baseDelayMs, attempt);
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
}
