/**
 * TypeSafe Jev bridge — sourcevision's client for judgment-shaped calls.
 *
 * Jev is a System One model: it answers typed questions over a state object
 * with calibrated probabilities and generates no text. That makes it the
 * wrong tool for zone naming and the right one for classification, where the
 * answer is one id from a fixed catalog and today's free-text JSON path has to
 * parse, validate, and retry around output that Jev structurally cannot get
 * malformed. It is deliberately *not* a `ClaudeClient`: there is no
 * `complete()` to implement, so call sites branch to {@link askJev} before
 * `callClaude` rather than behind it.
 *
 * The HTTP contract is three fields in and three out, so this is a `fetch`
 * wrapper rather than a dependency on `@typesafe-ai/sdk`. Errors are mapped
 * onto `ClaudeClientError` reasons so the classify pass's existing handling
 * (stop on `auth`, degrade on anything else) applies unchanged.
 *
 * @see https://docs.typesafe.ai/api
 * @module sourcevision/analyzers/jev-client
 */

import { ClaudeClientError, TYPESAFE_API_KEY_ENV } from "@n-dx/llm-client";
import type { TokenUsage } from "../schema/index.js";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

/** Wall-clock cap per HTTP attempt. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Attempts on a transient (429 / 5xx / network) failure before giving up. */
const MAX_ATTEMPTS = 3;
/** Backoff base; doubles per attempt unless the server sends Retry-After. */
const BACKOFF_BASE_MS = 500;

// ── Questions ────────────────────────────────────────────────────────────────

/** JSON-serialisable value, for state and criteria payloads. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A Choice: pick one option from a fixed set. `criteria` maps each option to
 * a description — a string, or an object such as `{ what, not_for, examples }`
 * when neighbouring options are easy to confuse.
 */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, JsonValue>;
}

/** The question types this client sends. Noul and Score follow with the finding judgments. */
export type JevQuestion = ChoiceQuestion;

/** Build a Choice question. */
export function choice(
  instructions: string,
  criteria: Record<string, JsonValue>,
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

// ── Answers ──────────────────────────────────────────────────────────────────

export interface ChoiceAnswer {
  type: "choice";
  /** The highest-probability option. */
  choice: string;
  /** Distribution across every option; sums to 1. */
  probabilities: Record<string, number>;
  /** 0–1, from the spread of the distribution — not the probability of `choice`. */
  confidence: number;
}

export type JevAnswer = ChoiceAnswer;

export interface JevRequest {
  /** What the questions are about. Prefer named fields; reference them in instructions as `path.to.field`. */
  state: JsonValue;
  /** Question id → question. Ids are for code; the model never sees them. */
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  /** The concrete model that answered, e.g. `jev-1.13.0`. */
  model: string;
  /** One answer per question id in the request. */
  answers: Record<string, JevAnswer>;
  tokenUsage?: TokenUsage;
}

export interface AskJevOptions {
  /** Injection seams for tests. */
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
}

// ── Call ─────────────────────────────────────────────────────────────────────

/**
 * Send one System One request. All questions run in parallel server-side and
 * cannot see each other's answers, so independent judgments over the same
 * state belong in one call.
 *
 * @throws ClaudeClientError — `auth` for a missing key or 401/403, `rate-limit`
 *   once retries on 429 are exhausted, `timeout` when an attempt exceeds
 *   {@link REQUEST_TIMEOUT_MS}, `unknown` for a 422 (the message carries the
 *   server's explanation of what was malformed), a persistent 5xx, or a
 *   response that does not carry an answer per question.
 */
export async function askJev(
  request: JevRequest,
  opts: AskJevOptions = {},
): Promise<JevResponse> {
  const env = opts.env ?? process.env;
  const apiKey = env[TYPESAFE_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw new ClaudeClientError(
      `${TYPESAFE_API_KEY_ENV} is not set — judgment calls need a TypeSafe API key`,
      "auth",
      false,
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const body = JSON.stringify({
    state: request.state,
    model: JEV_MODEL,
    questions: request.questions,
  });

  let lastTransient: ClaudeClientError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ClaudeClientError(`Jev request timed out after ${REQUEST_TIMEOUT_MS}ms`, "timeout", true);
      }
      lastTransient = new ClaudeClientError(
        `Jev request failed: ${err instanceof Error ? err.message : String(err)}`,
        "unknown",
        true,
      );
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) {
      return parseResponse(await res.json(), Object.keys(request.questions));
    }

    const detail = await safeText(res);
    if (res.status === 401 || res.status === 403) {
      throw new ClaudeClientError(`TypeSafe rejected the API key (${res.status})${detail}`, "auth", false);
    }
    if (res.status === 422) {
      throw new ClaudeClientError(`TypeSafe rejected the request body (422)${detail}`, "unknown", false);
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      lastTransient = new ClaudeClientError(
        `TypeSafe ${res.status === 429 ? "rate-limited" : "returned " + res.status} the request${detail}`,
        res.status === 429 ? "rate-limit" : "unknown",
        true,
        retryAfterMs,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryAfterMs ?? BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
      continue;
    }
    throw new ClaudeClientError(`TypeSafe returned ${res.status}${detail}`, "unknown", false);
  }

  throw lastTransient ?? new ClaudeClientError("Jev request failed", "unknown", true);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

function parseResponse(raw: unknown, questionIds: string[]): JevResponse {
  const obj = asRecord(raw);
  const answersRaw = obj ? asRecord(obj.answers) : undefined;
  if (!obj || !answersRaw) {
    throw new ClaudeClientError("TypeSafe response has no answers object", "unknown", false);
  }
  const answers: Record<string, JevAnswer> = {};
  for (const id of questionIds) {
    const a = asRecord(answersRaw[id]);
    if (!a || a.type !== "choice" || typeof a.choice !== "string" || !asRecord(a.probabilities)) {
      throw new ClaudeClientError(`TypeSafe response is missing a choice answer for question "${id}"`, "unknown", false);
    }
    answers[id] = {
      type: "choice",
      choice: a.choice,
      probabilities: a.probabilities as Record<string, number>,
      confidence: typeof a.confidence === "number" ? a.confidence : 0,
    };
  }
  const usage = asRecord(obj.usage);
  const tokenUsage: TokenUsage | undefined = usage
    ? {
        input: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
        output: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
      }
    : undefined;
  return {
    model: typeof obj.model === "string" ? obj.model : JEV_MODEL,
    answers,
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Retry-After is seconds per RFC 9110; tolerate a millisecond-looking value. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 1000 ? n : n * 1000;
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return text ? `: ${text.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}
