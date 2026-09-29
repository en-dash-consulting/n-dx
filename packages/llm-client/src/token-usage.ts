/**
 * Token usage parsing utilities.
 *
 * Handles both Anthropic SDK response format and CLI stream-json format,
 * providing a single consistent TokenUsage shape.
 *
 * ## Diagnostic-aware parsing
 *
 * Each parser has a `*WithDiagnostic` variant that returns a
 * {@link TokenParseResult} pairing the parsed usage with a
 * {@link TokenDiagnosticStatus}. The status distinguishes "vendor returned
 * usage data" from "vendor omitted usage data (zeros are synthetic)":
 *
 * - `complete` — both input and output fields were present and numeric
 * - `partial` — only one of input/output was present; the other was backfilled to 0
 * - `unavailable` — neither field was present; values are synthetic zeros
 *
 * Call sites that need to surface degraded diagnostics (e.g. run records,
 * RuntimeDiagnostics) should use the `*WithDiagnostic` variants.
 */

import type { TokenUsage } from "./types.js";
import type { TokenDiagnosticStatus } from "./runtime-contract.js";

// ── Diagnostic-aware result type ──────────────────────────────────────────

/**
 * Token usage paired with its diagnostic status.
 *
 * Used by diagnostic-aware parsers to distinguish "the vendor returned zeros"
 * from "the vendor omitted usage data and we backfilled zeros".
 */
export interface TokenParseResult {
  /** Parsed token usage (may be synthetic zeros when status is "unavailable"). */
  readonly usage: TokenUsage;
  /** Whether the usage data was fully present, partially present, or absent. */
  readonly diagnosticStatus: TokenDiagnosticStatus;
  /** Where the cache half of {@link usage} came from. */
  readonly cacheProvenance: TokenCacheProvenance;
}

/**
 * Where a run's cache token counts came from.
 *
 * The distinction this exists to draw is between a vendor that accounted for
 * caching and reported nothing cached, and a vendor that did not account for
 * it at all. Both leave `cacheReadInput` absent, and reporting either as a
 * plain `0` says "this run used no cache" — a claim only the first one
 * supports. A Codex CLI run scraped from `Tokens used: N in, N out` has no
 * cache accounting whatsoever, and for months read as a run that cached
 * nothing while its JSONL was reporting 35k cached input tokens a turn.
 *
 * - `measured` — the vendor reported cache fields; the counts are its own.
 * - `estimated` — the counts were derived rather than reported. No parser
 *   produces this today; it exists so a future estimator cannot be mistaken
 *   for a measurement.
 * - `unavailable` — no cache accounting was present. Read the counts as
 *   unknown, not as zero.
 */
export type TokenCacheProvenance = "measured" | "estimated" | "unavailable";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Classify the diagnostic status from presence of the two primary fields. */
function classifyPresence(
  hasInput: boolean,
  hasOutput: boolean,
): TokenDiagnosticStatus {
  if (hasInput && hasOutput) return "complete";
  if (hasInput || hasOutput) return "partial";
  return "unavailable";
}

/** Cache accounting read off a vendor payload, normalized to one shape. */
interface CacheAccounting
  extends Pick<TokenUsage, "cacheCreationInput" | "cacheReadInput"> {
  /**
   * Tokens already counted inside the vendor's input figure that belong to
   * the cache half. Subtracted from `input` so the two are not counted twice.
   */
  readonly inputAdjustment: number;
  readonly provenance: TokenCacheProvenance;
}

/** Read a field that must be a finite non-negative number, or undefined. */
function cacheCount(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Extract cache accounting from a raw usage object, in either vendor's dialect.
 *
 * The two dialects disagree about what `input` means, and the disagreement is
 * the whole reason this is one function rather than two field lookups:
 *
 * - **Anthropic** reports `input_tokens` *excluding* both cache halves, with
 *   `cache_creation_input_tokens` and `cache_read_input_tokens` alongside it.
 * - **Codex** reports `input_tokens` as the turn's whole input, with
 *   `cached_input_tokens` naming the portion of it served from cache (the
 *   `prompt_tokens_details.cached_tokens` convention), plus
 *   `cache_write_input_tokens` as a separate class the way Anthropic's
 *   creation counter is.
 *
 * So Codex's cached half is subtracted from `input` and Anthropic's is not.
 * Without that, a Codex turn reporting 45,472 in / 35,072 cached would total
 * 80,544 — a 77% overcount — which is the trap that keeps the two dialects
 * from being merged into one key list.
 *
 * Zero-valued fields are still *presence*: `"cached_input_tokens": 0` is the
 * vendor saying nothing was cached, which is a measurement. Only their absence
 * is `unavailable`. The counts themselves stay omitted when zero, so the
 * on-disk shape is unchanged for runs that cached nothing.
 */
function extractCacheAccounting(source: Record<string, unknown>): CacheAccounting {
  const anthropicCreation = cacheCount(source, "cache_creation_input_tokens");
  const anthropicRead = cacheCount(source, "cache_read_input_tokens");
  const codexWrite = cacheCount(source, "cache_write_input_tokens");
  const codexRead = cacheCount(source, "cached_input_tokens");

  const creation = anthropicCreation ?? codexWrite;
  const read = anthropicRead ?? codexRead;

  const measured =
    anthropicCreation !== undefined ||
    anthropicRead !== undefined ||
    codexWrite !== undefined ||
    codexRead !== undefined;

  const result: CacheAccounting = {
    // Only Codex's read counter is part of its input figure. `anthropicRead`
    // takes precedence above, so a payload carrying both keys is read in the
    // Anthropic dialect and adjusts nothing.
    inputAdjustment: anthropicRead === undefined && codexRead !== undefined ? codexRead : 0,
    provenance: measured ? "measured" : "unavailable",
  };
  if (creation !== undefined && creation > 0) result.cacheCreationInput = creation;
  if (read !== undefined && read > 0) result.cacheReadInput = read;
  return result;
}

/** Build the usage half of a parse result, applying the cache adjustment. */
function withCacheAccounting(
  input: number,
  output: number,
  cache: CacheAccounting,
): TokenUsage {
  const usage: TokenUsage = {
    // Clamped: a vendor reporting more cached than total input is malformed,
    // and a negative token count would corrupt every rollup downstream.
    input: Math.max(0, input - cache.inputAdjustment),
    output,
  };
  if (cache.cacheCreationInput !== undefined) usage.cacheCreationInput = cache.cacheCreationInput;
  if (cache.cacheReadInput !== undefined) usage.cacheReadInput = cache.cacheReadInput;
  return usage;
}

// ── API token parsing ─────────────────────────────────────────────────────

/**
 * Parse token usage from an Anthropic API SDK response `usage` object.
 *
 * The SDK response always has `input_tokens` / `output_tokens` at the top level.
 * Cache fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) are
 * present on some models/versions but not typed in the SDK, so we extract them
 * from the raw object.
 *
 * Always returns a TokenUsage — missing numeric fields default to 0.
 * Cache fields are omitted when zero or absent.
 */
export function parseApiTokenUsage(
  raw: Record<string, unknown>,
): TokenUsage {
  return parseApiTokenUsageWithDiagnostic(raw).usage;
}

/**
 * Diagnostic-aware variant of {@link parseApiTokenUsage}.
 *
 * Returns both the parsed usage and a {@link TokenDiagnosticStatus} indicating
 * whether the vendor provided complete, partial, or no usage data.
 */
export function parseApiTokenUsageWithDiagnostic(
  raw: Record<string, unknown>,
): TokenParseResult {
  const hasInput = typeof raw.input_tokens === "number";
  const hasOutput = typeof raw.output_tokens === "number";

  const input = hasInput ? (raw.input_tokens as number) : 0;
  const output = hasOutput ? (raw.output_tokens as number) : 0;
  const cache = extractCacheAccounting(raw);

  return {
    usage: withCacheAccounting(input, output, cache),
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
    cacheProvenance: cache.provenance,
  };
}

// ── CLI token parsing ─────────────────────────────────────────────────────

/**
 * Parse token usage from a Claude CLI JSON envelope.
 *
 * Claude CLI --output-format json includes usage fields at the top level:
 * `input_tokens` / `total_input_tokens`, `output_tokens` / `total_output_tokens`.
 *
 * Returns undefined when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseCliTokenUsage(
  envelope: Record<string, unknown>,
): TokenUsage | undefined {
  const result = parseCliTokenUsageWithDiagnostic(envelope);
  return result.diagnosticStatus === "unavailable" ? undefined : result.usage;
}

/**
 * Diagnostic-aware variant of {@link parseCliTokenUsage}.
 *
 * Returns a {@link TokenParseResult} instead of `undefined` for missing data,
 * allowing callers to surface the "unavailable" status explicitly.
 */
export function parseCliTokenUsageWithDiagnostic(
  envelope: Record<string, unknown>,
): TokenParseResult {
  const rawInput = envelope.input_tokens ?? envelope.total_input_tokens;
  const rawOutput = envelope.output_tokens ?? envelope.total_output_tokens;

  const hasInput = typeof rawInput === "number";
  const hasOutput = typeof rawOutput === "number";
  const cache = extractCacheAccounting(envelope);

  return {
    usage: withCacheAccounting(
      hasInput ? (rawInput as number) : 0,
      hasOutput ? (rawOutput as number) : 0,
      cache,
    ),
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
    cacheProvenance: cache.provenance,
  };
}

// ── Stream token parsing ──────────────────────────────────────────────────

/**
 * Parse token usage from a CLI stream-json event.
 *
 * Stream-json events may include token usage:
 * - At the top level: `input_tokens`, `output_tokens`
 * - As fallback: `total_input_tokens`, `total_output_tokens`
 * - Inside a nested `usage` object (some CLI versions)
 *
 * Prefers `input_tokens` over `total_input_tokens`.
 * Prefers top-level fields over nested `usage` object.
 * Returns undefined when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseStreamTokenUsage(
  obj: Record<string, unknown>,
): TokenUsage | undefined {
  const result = parseStreamTokenUsageWithDiagnostic(obj);
  return result.diagnosticStatus === "unavailable" ? undefined : result.usage;
}

/**
 * Diagnostic-aware variant of {@link parseStreamTokenUsage}.
 *
 * Returns a {@link TokenParseResult} instead of `undefined` for missing data,
 * allowing callers to surface the "unavailable" status explicitly.
 */
export function parseStreamTokenUsageWithDiagnostic(
  obj: Record<string, unknown>,
): TokenParseResult {
  // Try direct fields first (prefer input_tokens over total_input_tokens)
  let rawInput: unknown = obj.input_tokens ?? obj.total_input_tokens;
  let rawOutput: unknown = obj.output_tokens ?? obj.total_output_tokens;
  let cacheSource: Record<string, unknown> = obj;

  // Try nested usage object (stream-json format) — only if top-level has nothing
  if (
    typeof rawInput !== "number" &&
    typeof rawOutput !== "number" &&
    obj.usage &&
    typeof obj.usage === "object" &&
    !Array.isArray(obj.usage)
  ) {
    const nested = obj.usage as Record<string, unknown>;
    rawInput = nested.input_tokens ?? nested.total_input_tokens;
    rawOutput = nested.output_tokens ?? nested.total_output_tokens;
    cacheSource = nested;
  }

  const hasInput = typeof rawInput === "number";
  const hasOutput = typeof rawOutput === "number";
  const cache = extractCacheAccounting(cacheSource);

  return {
    usage: withCacheAccounting(
      hasInput ? (rawInput as number) : 0,
      hasOutput ? (rawOutput as number) : 0,
      cache,
    ),
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
    cacheProvenance: cache.provenance,
  };
}

// ── Codex token parsing ───────────────────────────────────────────────────

/** Safe cast to Record<string, unknown> or undefined. */
function asUsageRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Read first matching numeric field from an object. */
function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Token usage result from Codex payload mapping.
 *
 * Uses the vendor-neutral {@link TokenDiagnosticStatus} instead of the
 * previous Codex-specific string literal. Callers can inspect
 * `diagnosticStatus` to determine if usage data was present.
 */
export interface CodexTokenMapping {
  usage: TokenUsage;
  total: number;
  diagnosticStatus: TokenDiagnosticStatus;
  /** Where `usage`'s cache half came from. See {@link TokenCacheProvenance}. */
  cacheProvenance: TokenCacheProvenance;
}

/**
 * Map Codex usage payload fields into the shared token usage shape.
 *
 * Explicit field mapping:
 * - input: `input_tokens` | `prompt_tokens`, less the cached portion
 * - output: `output_tokens` | `completion_tokens`
 * - cache: `cached_input_tokens` / `cache_write_input_tokens`, via
 *   {@link extractCacheAccounting}
 * - total: `total_tokens` fallback, otherwise the input as reported plus output
 *
 * `total` stays the figure the vendor reported, so splitting the cached half
 * out of `input` does not change what the turn cost — only how it is
 * attributed.
 *
 * When usage is missing, returns zeros and `diagnosticStatus: "unavailable"`.
 * When all fields are present, returns `diagnosticStatus: "complete"`.
 */
export function mapCodexUsageToTokenUsage(raw: unknown): CodexTokenMapping {
  const top = asUsageRecord(raw);
  const usage = asUsageRecord(top?.usage)
    ?? asUsageRecord(asUsageRecord(top?.response)?.usage)
    ?? asUsageRecord(asUsageRecord(top?.data)?.usage);

  if (!usage && !top) {
    return {
      usage: { input: 0, output: 0 },
      total: 0,
      diagnosticStatus: "unavailable",
      cacheProvenance: "unavailable",
    };
  }

  const source = usage ?? top ?? {};

  const input = readNumber(source, ["input_tokens", "prompt_tokens", "input"]) ?? 0;
  const output = readNumber(source, ["output_tokens", "completion_tokens", "output"]) ?? 0;
  const total = readNumber(source, ["total_tokens", "total"]) ?? (input + output);
  const cache = extractCacheAccounting(source);

  const hasUsageFields = usage
    ? input > 0 || output > 0 || total > 0
    : readNumber(source, ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens"]) !== undefined;

  return {
    usage: withCacheAccounting(input, output, cache),
    total,
    diagnosticStatus: hasUsageFields ? "complete" : "unavailable",
    cacheProvenance: cache.provenance,
  };
}

// ── Token accumulation ────────────────────────────────────────────────────

/**
 * Aggregated token usage across multiple API calls.
 *
 * Used by domain and execution layers to accumulate usage data from
 * multiple parsing calls without redundant implementations.
 */
export interface AggregateTokenUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Create an empty AggregateTokenUsage accumulator.
 *
 * Used as the initial value for accumulation loops.
 */
export function emptyAggregateTokenUsage(): AggregateTokenUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

/**
 * Accumulate a single call's token usage into the aggregate.
 *
 * Always increments the call count, even when `usage` is undefined
 * (e.g. when the API response omitted usage data).
 */
export function accumulateTokenUsage(
  aggregate: AggregateTokenUsage,
  usage?: TokenUsage,
): void {
  aggregate.calls++;
  if (!usage) return;
  aggregate.inputTokens += usage.input;
  aggregate.outputTokens += usage.output;
  if (usage.cacheCreationInput) {
    aggregate.cacheCreationInputTokens =
      (aggregate.cacheCreationInputTokens ?? 0) + usage.cacheCreationInput;
  }
  if (usage.cacheReadInput) {
    aggregate.cacheReadInputTokens =
      (aggregate.cacheReadInputTokens ?? 0) + usage.cacheReadInput;
  }
}
